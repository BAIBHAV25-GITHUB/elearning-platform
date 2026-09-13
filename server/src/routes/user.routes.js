import express from 'express';
import {
  updateProfile,
  changePassword,
  getAllUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
  deleteUser,
} from '../controllers/user.controller.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware.js';

const router = express.Router();

// Apply token validation middleware across all user management routes
router.use(authenticateToken);

// Authenticated user profile routes (Student, Instructor, Admin)
router.put('/profile', updateProfile);
router.put('/change-password', changePassword);

// Specific user profile details (Admin or Account Owner)
router.get('/:id', getUserById);

// Admin-only administrative user management routes
router.get('/', authorizeRoles('Admin'), getAllUsers);
router.patch('/:id/status', authorizeRoles('Admin'), updateUserStatus);
router.patch('/:id/role', authorizeRoles('Admin'), updateUserRole);
router.delete('/:id', authorizeRoles('Admin'), deleteUser);

export default router;