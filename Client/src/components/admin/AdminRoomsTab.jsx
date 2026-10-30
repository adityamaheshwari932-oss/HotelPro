import React, { useState, useEffect, useCallback } from 'react';
import { getAdminRooms, updateRoom, updateRoomStatus } from '../../api/roomApi';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Operational Statuses' },
  { value: 'active', label: 'Active (Bookable)' },
  { value: 'maintenance', label: 'Under Maintenance' },
  { value: 'inactive', label: 'Inactive (Decommissioned)' }
];

const ROOM_TYPE_OPTIONS = [
  { value: 'all', label: 'All Room Types' },
  { value: 'single', label: 'Single Sanctuary' },
  { value: 'double', label: 'Double Sanctuary' },
  { value: 'suite', label: 'Luxury Suite' }
];

export const AdminRoomsTab = ({ onNavigateToAddRoom }) => {
  const [rooms, setRooms] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);

  // Status Change Modal State
  const [selectedRoomForStatus, setSelectedRoomForStatus] = useState(null);
  const [newStatus, setNewStatus] = useState('active');
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState(null);

  // Edit Room Modal State
  const [editingRoom, setEditingRoom] = useState(null);
  const [editFormData, setEditFormData] = useState({
    roomNumber: '',
    roomType: 'single',
    capacity: 1,
    basePrice: 100,
    description: '',
    photos: ''
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  const fetchRooms = useCallback(async (page = 1) => {
    try {
      setIsLoading(true);
      setApiError(null);

      const params = {
        page,
        limit: 10
      };
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      if (roomTypeFilter && roomTypeFilter !== 'all') params.roomType = roomTypeFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getAdminRooms(params);
      setRooms(res.data?.rooms || []);
      if (res.data?.pagination) {
        setPagination(res.data.pagination);
      }
    } catch (err) {
      setApiError(err.message || 'Failed to load rooms inventory.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, roomTypeFilter, searchQuery]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      fetchRooms(1);
    });
  }, [fetchRooms]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchRooms(1);
  };

  const handleOpenStatusModal = (room) => {
    setSelectedRoomForStatus(room);
    setNewStatus(room.status || 'active');
    setStatusError(null);
  };

  const handleStatusSubmit = async (e) => {
    e.preventDefault();
    if (!selectedRoomForStatus) return;

    try {
      setStatusSubmitting(true);
      setStatusError(null);
      await updateRoomStatus(selectedRoomForStatus._id, newStatus);
      setSuccessBanner(`Room ${selectedRoomForStatus.roomNumber} status successfully updated to ${newStatus}.`);
      setSelectedRoomForStatus(null);
      fetchRooms(pagination.page);
    } catch (err) {
      setStatusError(err.message || 'Failed to update room operational status.');
    } finally {
      setStatusSubmitting(false);
    }
  };

  const handleOpenEditModal = (room) => {
    setEditingRoom(room);
    setEditFormData({
      roomNumber: room.roomNumber || '',
      roomType: room.roomType || 'single',
      capacity: room.capacity || 1,
      basePrice: room.basePrice || 0,
      description: room.description || '',
      photos: Array.isArray(room.photos) ? room.photos.join('\n') : ''
    });
    setEditError(null);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingRoom) return;

    // Validation
    const basePriceNum = parseFloat(editFormData.basePrice);
    const capacityNum = parseInt(editFormData.capacity, 10);

    if (isNaN(basePriceNum) || basePriceNum < 0) {
      setEditError('Base price must be a non-negative number.');
      return;
    }

    if (isNaN(capacityNum) || capacityNum < 1) {
      setEditError('Capacity must be at least 1 guest.');
      return;
    }

    if (!editFormData.roomNumber.trim()) {
      setEditError('Room number is required.');
      return;
    }

    const photosArray = editFormData.photos
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    try {
      setEditSubmitting(true);
      setEditError(null);

      await updateRoom(editingRoom._id, {
        roomNumber: editFormData.roomNumber.trim(),
        roomType: editFormData.roomType,
        capacity: capacityNum,
        basePrice: basePriceNum,
        description: editFormData.description.trim(),
        photos: photosArray
      });

      setSuccessBanner(`Room ${editFormData.roomNumber} updated successfully.`);
      setEditingRoom(null);
      fetchRooms(pagination.page);
    } catch (err) {
      setEditError(err.message || 'Failed to update room.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const formatPrice = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount || 0);
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'active':
        return 'badge-status-active';
      case 'maintenance':
        return 'badge-status-maintenance';
      case 'inactive':
        return 'badge-status-inactive';
      default:
        return 'badge-status-default';
    }
  };

  return (
    <div className="admin-tab-content" data-testid="admin-rooms-tab">
      {/* Tab Header & Action Bar */}
      <div className="admin-section-header">
        <div>
          <h3>Room Inventory Management</h3>
          <p className="admin-section-desc">
            Complete inventory overview across active, maintenance, and decommissioned rooms.
          </p>
        </div>
        {onNavigateToAddRoom && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNavigateToAddRoom}
            data-testid="btn-go-to-add-room"
          >
            + Add New Room
          </button>
        )}
      </div>

      {successBanner && (
        <div className="alert alert-success" role="alert" data-testid="rooms-success-banner">
          <p>{successBanner}</p>
          <button
            type="button"
            className="alert-dismiss-btn"
            onClick={() => setSuccessBanner(null)}
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="admin-filters-bar">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <input
            type="text"
            placeholder="Search room number (e.g. 101)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input search-input"
            data-testid="rooms-search-input"
            aria-label="Search rooms by number"
          />
          <button type="submit" className="btn btn-secondary btn-sm">
            Search
          </button>
        </form>

        <div className="admin-filters-group">
          <div className="filter-item">
            <label htmlFor="roomStatusFilter" className="filter-label">
              Status:
            </label>
            <select
              id="roomStatusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-input form-select"
              data-testid="rooms-status-filter"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label htmlFor="roomTypeFilter" className="filter-label">
              Type:
            </label>
            <select
              id="roomTypeFilter"
              value={roomTypeFilter}
              onChange={(e) => setRoomTypeFilter(e.target.value)}
              className="form-input form-select"
              data-testid="rooms-type-filter"
            >
              {ROOM_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Inventory Table / Content */}
      {isLoading ? (
        <div className="loading-state" data-testid="rooms-loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading sanctuary inventory...</p>
        </div>
      ) : apiError ? (
        <div className="alert alert-error" data-testid="rooms-error-state">
          <p>{apiError}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => fetchRooms(1)}>
            Retry Loading
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <div className="empty-state" data-testid="rooms-empty-state">
          <div className="empty-icon" aria-hidden="true">🏨</div>
          <h4>No Rooms Found</h4>
          <p>No rooms match your filter criteria or search query.</p>
          {onNavigateToAddRoom && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3"
              onClick={onNavigateToAddRoom}
            >
              Create New Room
            </button>
          )}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="admin-table" data-testid="admin-rooms-table">
            <thead>
              <tr>
                <th scope="col">Room</th>
                <th scope="col">Property / Hotel</th>
                <th scope="col">Type</th>
                <th scope="col">Capacity</th>
                <th scope="col">Base Rate</th>
                <th scope="col">Operational Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room._id} data-testid={`room-row-${room._id}`}>
                  <td>
                    <div className="room-number-cell">
                      <span className="room-number-badge">#{room.roomNumber}</span>
                      {room.photos && room.photos.length > 0 && (
                        <span className="photo-count-pill" title={`${room.photos.length} photos attached`}>
                          📷 {room.photos.length}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="hotel-cell-info">
                      <strong>{room.hotel?.name || 'HotelPro Sanctuary'}</strong>
                      <span className="hotel-location-sub">
                        {room.hotel?.address?.city || 'Cupertino'}, {room.hotel?.address?.state || 'CA'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="room-type-tag">
                      {room.roomType ? room.roomType.charAt(0).toUpperCase() + room.roomType.slice(1) : 'Standard'}
                    </span>
                  </td>
                  <td>
                    <span className="capacity-pill">
                      👥 {room.capacity} {room.capacity === 1 ? 'Guest' : 'Guests'}
                    </span>
                  </td>
                  <td>
                    <span className="price-tag">{formatPrice(room.basePrice)}/night</span>
                  </td>
                  <td>
                    <span className={`status-badge ${getStatusBadgeClass(room.status)}`}>
                      {room.status ? room.status.toUpperCase() : 'ACTIVE'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleOpenEditModal(room)}
                        data-testid={`btn-edit-room-${room._id}`}
                        aria-label={`Edit details for room ${room.roomNumber}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleOpenStatusModal(room)}
                        data-testid={`btn-status-room-${room._id}`}
                        aria-label={`Change status for room ${room.roomNumber}`}
                      >
                        Status
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="admin-pagination" data-testid="rooms-pagination">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => fetchRooms(pagination.page - 1)}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className="pagination-info">
            Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.total} total)
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages || isLoading}
            onClick={() => fetchRooms(pagination.page + 1)}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}

      {/* Change Operational Status Modal */}
      {selectedRoomForStatus && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedRoomForStatus(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-modal-title"
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="status-modal-title">
                Update Status — Room {selectedRoomForStatus.roomNumber}
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedRoomForStatus(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStatusSubmit} className="modal-form">
              {statusError && (
                <div className="alert alert-error" role="alert">
                  <p>{statusError}</p>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="newRoomStatusSelect" className="form-label">
                  Select Operational Status:
                </label>
                <select
                  id="newRoomStatusSelect"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="form-input form-select"
                  data-testid="status-modal-select"
                >
                  <option value="active">Active (Available for customer booking)</option>
                  <option value="maintenance">Maintenance (Offline for upkeep/cleaning)</option>
                  <option value="inactive">Inactive (Decommissioned)</option>
                </select>
                <small className="form-help-text">
                  Rooms set to maintenance or inactive are instantly excluded from customer availability search.
                </small>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedRoomForStatus(null)}
                  disabled={statusSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={statusSubmitting}
                  data-testid="btn-submit-room-status"
                >
                  {statusSubmitting ? 'Updating...' : 'Save Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {editingRoom && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingRoom(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-room-modal-title"
        >
          <div className="modal-content modal-content-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="edit-room-modal-title">
                Edit Room {editingRoom.roomNumber}
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingRoom(null)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="modal-form">
              {editError && (
                <div className="alert alert-error" role="alert" data-testid="edit-room-error">
                  <p>{editError}</p>
                </div>
              )}

              <div className="form-grid-2">
                <div className="form-group">
                  <label htmlFor="editRoomNumber" className="form-label">
                    Room Number: <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    id="editRoomNumber"
                    value={editFormData.roomNumber}
                    onChange={(e) => setEditFormData({ ...editFormData, roomNumber: e.target.value })}
                    className="form-input"
                    required
                    data-testid="edit-room-number-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="editRoomType" className="form-label">
                    Room Type: <span className="text-danger">*</span>
                  </label>
                  <select
                    id="editRoomType"
                    value={editFormData.roomType}
                    onChange={(e) => setEditFormData({ ...editFormData, roomType: e.target.value })}
                    className="form-input form-select"
                    data-testid="edit-room-type-select"
                  >
                    <option value="single">Single</option>
                    <option value="double">Double</option>
                    <option value="suite">Suite</option>
                  </select>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label htmlFor="editRoomCapacity" className="form-label">
                    Max Capacity (Guests): <span className="text-danger">*</span>
                  </label>
                  <input
                    type="number"
                    id="editRoomCapacity"
                    min="1"
                    max="10"
                    value={editFormData.capacity}
                    onChange={(e) => setEditFormData({ ...editFormData, capacity: e.target.value })}
                    className="form-input"
                    required
                    data-testid="edit-room-capacity-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="editRoomBasePrice" className="form-label">
                    Base Nightly Rate ($ USD): <span className="text-danger">*</span>
                  </label>
                  <input
                    type="number"
                    id="editRoomBasePrice"
                    min="0"
                    step="1"
                    value={editFormData.basePrice}
                    onChange={(e) => setEditFormData({ ...editFormData, basePrice: e.target.value })}
                    className="form-input"
                    required
                    data-testid="edit-room-price-input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="editRoomDescription" className="form-label">
                  Description:
                </label>
                <textarea
                  id="editRoomDescription"
                  rows="3"
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                  className="form-input form-textarea"
                  data-testid="edit-room-desc-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="editRoomPhotos" className="form-label">
                  Photo URLs (one URL per line):
                </label>
                <textarea
                  id="editRoomPhotos"
                  rows="3"
                  value={editFormData.photos}
                  onChange={(e) => setEditFormData({ ...editFormData, photos: e.target.value })}
                  className="form-input form-textarea"
                  placeholder="https://images.unsplash.com/..."
                  data-testid="edit-room-photos-input"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingRoom(null)}
                  disabled={editSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={editSubmitting}
                  data-testid="btn-save-room-edit"
                >
                  {editSubmitting ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRoomsTab;
