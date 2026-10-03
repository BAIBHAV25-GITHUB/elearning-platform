// import jwt from 'jsonwebtoken';

// const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// export const authenticateJWT = (req, res, next) => {
//   const authHeader = req.headers.authorization;

//   if (authHeader && authHeader.startsWith('Bearer ')) {
//     const token = authHeader.split(' ')[1];

//     jwt.verify(token, JWT_SECRET, (err, decoded) => {
//       if (err) {
//         return res.status(403).json({ message: 'Forbidden: Invalid or expired token' });
//       }
//       req.user = decoded; // Contains { id, role }
//       next();
//     });
//   } else {
//     res.status(401).json({ message: 'Unauthorized: Token missing' });
//   }
// };

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ message: 'Forbidden: Invalid or expired token' });
      }

      // Normalize req.user to ensure req.user.id is always populated
      req.user = {
        ...decoded,
        id: decoded.id || decoded.userId || decoded.user_id,
        role: decoded.role,
        email: decoded.email
      };

      next();
    });
  } else {
    res.status(401).json({ message: 'Unauthorized: Token missing' });
  }
};