const userService = require('../services/user.service');

/**
 * Lists users with pagination, search, and filters (Admin only).
 *
 * Route: GET /api/users
 * Access: Protected (Admin)
 */
const listUsers = async (req, res, next) => {
  try {
    const result = await userService.listUsers(req.query);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listUsers
};
