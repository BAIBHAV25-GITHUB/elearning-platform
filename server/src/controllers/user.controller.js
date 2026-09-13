import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

/**
 * Updates the profile of the currently logged-in user (name, bio, avatar_url).
 * Route: PUT /api/v1/users/profile
 * Access: Private (Student, Instructor, Admin)
 */
export const updateProfile = async (req, res) => {
  const userId = req.user.userId;
  const { user_name, bio, avatar_url } = req.body;

  if (!user_name || user_name.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Name field cannot be empty.',
    });
  }

  try {
    const query = `
      UPDATE users
      SET 
        user_name = $1,
        bio = $2,
        avatar_url = $3
      WHERE id = $4
      RETURNING id, user_name, email, bio, avatar_url, status, created_at;
    `;

    const values = [user_name.trim(), bio || null, avatar_url || null, userId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating profile.',
    });
  }
};

/**
 * Changes password for the currently logged-in user.
 * Route: PUT /api/v1/users/change-password
 * Access: Private (Student, Instructor, Admin)
 */
export const changePassword = async (req, res) => {
  const userId = req.user.userId;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      success: false,
      message: 'Both current password and new password are required.',
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters long.',
    });
  }

  try {
    const userQuery = 'SELECT password_hash FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    const currentHash = userResult.rows[0].password_hash;
    const isMatch = await bcrypt.compare(current_password, currentHash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect current password.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const newHashedPassword = await bcrypt.hash(new_password, salt);

    const updateQuery = 'UPDATE users SET password_hash = $1 WHERE id = $2';
    await pool.query(updateQuery, [newHashedPassword, userId]);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (error) {
    console.error('Change Password Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while changing password.',
    });
  }
};

/**
 * Gets a paginated list of all users with search and filter support.
 * Route: GET /api/v1/users
 * Access: Private (Admin only)
 */
export const getAllUsers = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;
  const role = req.query.role || null;
  const status = req.query.status || null;

  try {
    let baseWhere = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;

    if (search) {
      baseWhere += ` AND (u.user_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      queryParams.push(search);
      paramIndex++;
    }

    if (status) {
      baseWhere += ` AND u.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (role) {
      baseWhere += ` AND r.role_name = $${paramIndex}`;
      queryParams.push(role);
      paramIndex++;
    }

    const countQuery = `
      SELECT COUNT(DISTINCT u.id) AS total
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.role_id
      ${baseWhere};
    `;

    const countResult = await pool.query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalRecords / limit);

    const dataQuery = `
      SELECT 
        u.id, 
        u.user_name, 
        u.email, 
        u.bio, 
        u.avatar_url, 
        u.status, 
        u.created_at,
        ARRAY_AGG(r.role_name) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.role_id
      ${baseWhere}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    queryParams.push(limit, offset);
    const dataResult = await pool.query(dataQuery, queryParams);

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully.',
      meta: {
        totalRecords,
        totalPages,
        currentPage: page,
        limit,
      },
      data: dataResult.rows,
    });
  } catch (error) {
    console.error('Get All Users Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching users.',
    });
  }
};

/**
 * Gets profile details for a specific user ID.
 * Route: GET /api/v1/users/:id
 * Access: Private (Admin or Owner)
 */
export const getUserById = async (req, res) => {
  const targetUserId = req.params.id;
  const requestingUserId = req.user.userId;
  const requestingUserRoles = req.user.roles;

  const isAdmin = requestingUserRoles.includes('Admin');
  const isOwner = parseInt(targetUserId, 10) === requestingUserId;

  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: You do not have permission to view this profile.',
    });
  }

  try {
    const query = `
      SELECT 
        u.id, 
        u.user_name, 
        u.email, 
        u.bio, 
        u.avatar_url, 
        u.status, 
        u.created_at,
        ARRAY_AGG(r.role_name) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.role_id
      WHERE u.id = $1
      GROUP BY u.id;
    `;

    const result = await pool.query(query, [targetUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get User By ID Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching user details.',
    });
  }
};

/**
 * Updates a user's status (active, suspended, inactive).
 * Route: PATCH /api/v1/users/:id/status
 * Access: Private (Admin only)
 */
export const updateUserStatus = async (req, res) => {
  const targetUserId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['active', 'suspended', 'inactive'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Allowed values: ${validStatuses.join(', ')}`,
    });
  }

  try {
    const query = `
      UPDATE users
      SET status = $1
      WHERE id = $2
      RETURNING id, user_name, email, status, created_at;
    `;

    const result = await pool.query(query, [status, targetUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `User status updated to '${status}' successfully.`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update User Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating user status.',
    });
  }
};

/**
 * Updates user roles within a transaction block.
 * Route: PATCH /api/v1/users/:id/role
 * Access: Private (Admin only)
 */
export const updateUserRole = async (req, res) => {
  const targetUserId = req.params.id;
  const { role_name } = req.body;

  if (!role_name) {
    return res.status(400).json({
      success: false,
      message: 'role_name parameter is required.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify target user exists
    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    // 2. Fetch role_id for specified role name
    const roleResult = await client.query('SELECT role_id FROM roles WHERE role_name = $1', [role_name]);
    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Specified role '${role_name}' does not exist in roles schema.`,
      });
    }
    const roleId = roleResult.rows[0].role_id;

    // 3. Delete existing role associations for user
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [targetUserId]);

    // 4. Assign new role
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [targetUserId, roleId]);

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `User role successfully updated to '${role_name}'.`,
      data: {
        userId: parseInt(targetUserId, 10),
        roleAssigned: role_name,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update User Role Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while reassigning user role.',
    });
  } finally {
    client.release();
  }
};

/**
 * Soft deletes user account by setting status to inactive.
 * Route: DELETE /api/v1/users/:id
 * Access: Private (Admin only)
 */
export const deleteUser = async (req, res) => {
  const targetUserId = req.params.id;

  try {
    const query = `
      UPDATE users
      SET status = 'inactive'
      WHERE id = $1
      RETURNING id, user_name, email, status;
    `;

    const result = await pool.query(query, [targetUserId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User deactivated successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Delete User Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while deactivating user.',
    });
  }
};