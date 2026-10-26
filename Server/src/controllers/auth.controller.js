const authService = require('../services/auth.service');

/**
 * Handles customer registration.
 *
 * Route: POST /api/auth/register
 * Access: Public
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    const user = await authService.registerCustomer({
      name,
      email,
      password,
      phone
    });

    res.status(201).json({
      success: true,
      message: 'Customer account registered successfully',
      data: {
        user
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handles user login and issues JWT token.
 *
 * Route: POST /api/auth/login
 * Access: Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const authResult = await authService.loginUser({
      email,
      password
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: authResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Returns current authenticated user profile.
 *
 * Route: GET /api/auth/me
 * Access: Protected (Requires valid Bearer token)
 */
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
          phone: req.user.phone,
          status: req.user.status,
          createdAt: req.user.createdAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe
};
