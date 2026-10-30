const roomService = require('../services/room.service');

/**
 * Creates a new room (Admin only).
 *
 * Route: POST /api/rooms
 * Access: Protected (Admin)
 */
const createRoom = async (req, res, next) => {
  try {
    const room = await roomService.createRoom(req.body);

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: {
        room
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieves public room details by ID.
 *
 * Route: GET /api/rooms/:id
 * Access: Public
 */
const getRoomById = async (req, res, next) => {
  try {
    const room = await roomService.getRoomById(req.params.id);

    res.status(200).json({
      success: true,
      data: {
        room
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Updates permitted fields on an existing room (Admin only).
 *
 * Route: PATCH /api/rooms/:id
 * Access: Protected (Admin)
 */
const updateRoom = async (req, res, next) => {
  try {
    const room = await roomService.updateRoom(req.params.id, req.body);

    res.status(200).json({
      success: true,
      message: 'Room updated successfully',
      data: {
        room
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Updates the operational status of a room (Admin only).
 *
 * Route: PATCH /api/rooms/:id/status
 * Access: Protected (Admin)
 */
const updateRoomStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const room = await roomService.updateRoomStatus(req.params.id, status);

    res.status(200).json({
      success: true,
      message: `Room status updated to ${status}`,
      data: {
        room
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists rooms with pagination and filtering.
 *
 * Route: GET /api/rooms
 * Access: Public
 */
const listRooms = async (req, res, next) => {
  try {
    const result = await roomService.listRooms(req.query, req.user);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists rooms for administrators across all operational statuses (Admin only).
 *
 * Route: GET /api/rooms/admin
 * Access: Protected (Admin)
 */
const listAdminRooms = async (req, res, next) => {
  try {
    const result = await roomService.listAdminRooms(req.query);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Searches rooms available for a requested stay with dynamic availability and pricing.
 *
 * Route: GET /api/rooms/search
 * Access: Public
 */
const searchRooms = async (req, res, next) => {
  try {
    const searchResult = await roomService.searchAvailableRooms(req.query);

    res.status(200).json({
      success: true,
      data: searchResult
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRoom,
  getRoomById,
  updateRoom,
  updateRoomStatus,
  listRooms,
  listAdminRooms,
  searchRooms
};
