import React, { useState, useEffect, useCallback } from 'react';
import { getUsers } from '../../api/userApi';

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'customer', label: 'Customer Only' },
  { value: 'admin', label: 'Administrator Only' }
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Account Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' }
];

export const AdminUsersTab = () => {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState(null);

  const fetchUsers = useCallback(async (page = 1) => {
    try {
      setIsLoading(true);
      setApiError(null);

      const params = {
        page,
        limit: 10
      };
      if (roleFilter && roleFilter !== 'all') params.role = roleFilter;
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getUsers(params);
      setUsers(res.data?.users || []);
      if (res.data?.pagination) {
        setPagination(res.data.pagination);
      }
    } catch (err) {
      setApiError(err.message || 'Failed to load registered users directory.');
    } finally {
      setIsLoading(false);
    }
  }, [roleFilter, statusFilter, searchQuery]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      fetchUsers(1);
    });
  }, [fetchUsers]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchUsers(1);
  };

  const formatDateDisplay = (isoString) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return isoString;
    }
  };

  const getRoleBadgeClass = (role) => {
    return role === 'admin' ? 'badge-role-admin' : 'badge-role-customer';
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'active':
        return 'badge-status-active';
      case 'suspended':
        return 'badge-status-inactive';
      case 'inactive':
        return 'badge-status-maintenance';
      default:
        return 'badge-status-default';
    }
  };

  return (
    <div className="admin-tab-content" data-testid="admin-users-tab">
      <div className="admin-section-header">
        <div>
          <h3>Registered Users Directory</h3>
          <p className="admin-section-desc">
            Complete list of registered accounts across customer and administrative roles. Passwords and credentials remain securely hashed.
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="admin-filters-bar">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input search-input"
            data-testid="users-search-input"
            aria-label="Search users by name or email"
          />
          <button type="submit" className="btn btn-secondary btn-sm">
            Search
          </button>
        </form>

        <div className="admin-filters-group">
          <div className="filter-item">
            <label htmlFor="userRoleFilter" className="filter-label">
              Role:
            </label>
            <select
              id="userRoleFilter"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="form-input form-select"
              data-testid="users-role-filter"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label htmlFor="userStatusFilter" className="filter-label">
              Status:
            </label>
            <select
              id="userStatusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-input form-select"
              data-testid="users-status-filter"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Users Table / Content */}
      {isLoading ? (
        <div className="loading-state" data-testid="users-loading-state">
          <div className="spinner" aria-hidden="true" />
          <p>Loading users directory...</p>
        </div>
      ) : apiError ? (
        <div className="alert alert-error" data-testid="users-error-state">
          <p>{apiError}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => fetchUsers(1)}>
            Retry Loading
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state" data-testid="users-empty-state">
          <div className="empty-icon" aria-hidden="true">👥</div>
          <h4>No Users Found</h4>
          <p>No registered accounts match your current filter or search parameters.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="admin-table" data-testid="admin-users-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Member Since</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const initial = u.name ? u.name.trim()[0].toUpperCase() : 'U';
                return (
                  <tr key={u._id} data-testid={`user-row-${u._id}`}>
                    <td>
                      <div className="user-profile-cell">
                        <span className="user-avatar-circle small">{initial}</span>
                        <div>
                          <strong>{u.name}</strong>
                          <span className="user-id-sub" title={u._id}>
                            ID: {String(u._id).slice(-8)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="user-email-text">{u.email}</span>
                    </td>
                    <td>
                      <span className="user-phone-text">{u.phone || '—'}</span>
                    </td>
                    <td>
                      <span className={`role-badge ${getRoleBadgeClass(u.role)}`}>
                        {u.role ? u.role.toUpperCase() : 'CUSTOMER'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${getStatusBadgeClass(u.status)}`}>
                        {u.status ? u.status.toUpperCase() : 'ACTIVE'}
                      </span>
                    </td>
                    <td>
                      <span className="user-date-text">{formatDateDisplay(u.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="admin-pagination" data-testid="users-pagination">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => fetchUsers(pagination.page - 1)}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className="pagination-info">
            Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> ({pagination.total} total users)
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages || isLoading}
            onClick={() => fetchUsers(pagination.page + 1)}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminUsersTab;
