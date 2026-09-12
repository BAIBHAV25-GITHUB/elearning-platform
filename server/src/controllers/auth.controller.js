import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { generateToken } from '../utils/token.js';

/**
 * Registers a new user, hashes password, and assigns role in transaction.
 */
export const register = async (req, res) => {
  const { user_name, email, password, role_name = 'Student' } = req.body;

  if (!user_name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required fields.',
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email address format.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if user exists
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Insert user record without phone field
    const insertUserQuery = `
      INSERT INTO users (user_name, email, password_hash, status)
      VALUES ($1, $2, $3, 'active')
      RETURNING id, user_name, email, status, created_at;
    `;
    const userResult = await client.query(insertUserQuery, [user_name, email, hashedPassword]);
    const newUser = userResult.rows[0];

    // 4. Find requested role_id
    const roleResult = await client.query('SELECT role_id, role_name FROM roles WHERE role_name = $1', [role_name]);
    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Specified role '${role_name}' does not exist.`,
      });
    }
    const role = roleResult.rows[0];

    // 5. Assign role in junction table user_roles
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [newUser.id, role.role_id]);

    await client.query('COMMIT');

    const tokenPayload = {
      userId: newUser.id,
      email: newUser.email,
      roles: [role.role_name],
    };

    const token = generateToken(tokenPayload);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        token,
        user: {
          userId: newUser.id,
          userName: newUser.user_name,
          email: newUser.email,
          status: newUser.status,
          roles: [role.role_name],
          createdAt: newUser.created_at,
        },
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during user registration.',
    });
  } finally {
    client.release();
  }
};

/**
 * Authenticates user credentials and returns JWT token with assigned roles.
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required.',
    });
  }

  try {
    const query = `
      SELECT 
        u.id AS user_id, 
        u.user_name, 
        u.email, 
        u.password_hash AS password, 
        u.status,
        ARRAY_AGG(r.role_name) AS roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.role_id
      WHERE u.email = $1
      GROUP BY u.id;
    `;
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is currently ${user.status}. Please contact support.`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    const tokenPayload = {
      userId: user.user_id,
      email: user.email,
      roles: user.roles,
    };

    const token = generateToken(tokenPayload);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          userId: user.user_id,
          userName: user.user_name,
          email: user.email,
          status: user.status,
          roles: user.roles,
        },
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.',
    });
  }
};

/**
 * Fetches current logged-in user details based on req.user decoded token.
 */
export const getMe = async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id AS user_id, 
        u.user_name, 
        u.email, 
        u.status,
        u.created_at,
        ARRAY_AGG(r.role_name) AS roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.role_id
      WHERE u.id = $1
      GROUP BY u.id;
    `;
    const result = await pool.query(query, [req.user.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.',
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        userId: user.user_id,
        userName: user.user_name,
        email: user.email,
        status: user.status,
        roles: user.roles,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error fetching user profile.',
    });
  }
};