import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import pool from './config/db.js';
import authRoutes from './routes/auth.routes.js';

dotenv.config();

const app = express();

// Security and utility middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Core Health Endpoints
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'E-Learning API Service Operational',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/v1/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS current_time, current_database() AS db_name;');
    res.status(200).json({
      status: 'ok',
      message: 'Database Connection Successful',
      database: result.rows[0].db_name,
      serverTime: result.rows[0].current_time
    });
  } catch (error) {
    console.error('[DB HEALTH CHECK FAILED]:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Database Connection Failed',
      error: error.message
    });
  }
});

// Day 3 Auth Router Mount
app.use('/api/v1/auth', authRoutes);

// 404 Handler for Unmatched Routes
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route not found: ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[GLOBAL SERVER ERROR]:', err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal Server Error'
  });
});

export default app;