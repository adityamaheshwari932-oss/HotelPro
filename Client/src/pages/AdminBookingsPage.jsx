import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  getAdminBookings,
  updateAdminBookingStatus,
  getAdminReconciliations,
  processRefund
} from '../api/bookingApi';
import { PaymentStatusBadge } from '../components/payment/PaymentStatusBadge';
import { formatBookingReference } from '../utils/bookingUtils';

export const AdminBookingsPage = ({ embedded = false }) => {
  const [activeTab, setActiveTab] = useState('bookings'); // 'bookings' | 'reconciliation'

  // Bookings Tab State
  const [bookings, setBookings] = useState([]);
  const [bookingsPagination, setBookingsPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [bookingFilterStatus, setBookingFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState(null);

  // Status Update Modal State
  const [selectedBookingForStatus, setSelectedBookingForStatus] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState(null);

  // Reconciliation Tab State
  const [reconciliations, setReconciliations] = useState([]);
  const [reconciliationsPagination, setReconciliationsPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [reconciliationsLoading, setReconciliationsLoading] = useState(false);
  const [reconciliationsError, setReconciliationsError] = useState(null);

  // Refund Modal State
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundError, setRefundError] = useState(null);

  // Fetch Bookings
  const fetchBookings = useCallback(async (page = 1) => {
    await Promise.resolve();
    try {
      setBookingsLoading(true);
      setBookingsError(null);
      const params = {
        page,
        limit: 10
      };
      if (bookingFilterStatus) params.status = bookingFilterStatus;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getAdminBookings(params);
      setBookings(res.data?.bookings || []);
      if (res.data?.pagination) {
        setBookingsPagination(res.data.pagination);
      }
    } catch (err) {
      setBookingsError(err.message || 'Failed to load admin bookings.');
    } finally {
      setBookingsLoading(false);
    }
  }, [bookingFilterStatus, searchQuery]);

  // Fetch Reconciliations
  const fetchReconciliations = useCallback(async (page = 1) => {
    await Promise.resolve();
    try {
      setReconciliationsLoading(true);
      setReconciliationsError(null);
      const res = await getAdminReconciliations({ page, limit: 10 });
      setReconciliations(res.data?.reconciliations || []);
      if (res.data?.pagination) {
        setReconciliationsPagination(res.data.pagination);
      }
    } catch (err) {
      setReconciliationsError(err.message || 'Failed to load reconciliation records.');
    } finally {
      setReconciliationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (activeTab === 'bookings') {
        fetchBookings(1);
      } else if (activeTab === 'reconciliation') {
        fetchReconciliations(1);
      }
    });
  }, [activeTab, fetchBookings, fetchReconciliations]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchBookings(1);
  };

  const handleStatusUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBookingForStatus || !newStatus) return;

    try {
      setStatusSubmitting(true);
      setStatusError(null);
      await updateAdminBookingStatus(selectedBookingForStatus._id, {
        status: newStatus,
        reason: statusReason
      });
      setSelectedBookingForStatus(null);
      setNewStatus('');
      setStatusReason('');
      fetchBookings(bookingsPagination.page);
    } catch (err) {
      setStatusError(err.message || 'Failed to update booking status.');
    } finally {
      setStatusSubmitting(false);
    }
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    if (!refundTarget) return;

    try {
      setRefundSubmitting(true);
      setRefundError(null);
      await processRefund(refundTarget._id || refundTarget.id, {
        amount: refundTarget.amount,
        reason: refundReason.trim() || 'Administrative refund processed from reconciliation queue'
      });
      setRefundTarget(null);
      setRefundReason('');
      fetchReconciliations(reconciliationsPagination.page);
    } catch (err) {
      setRefundError(err.message || 'Failed to process refund.');
    } finally {
      setRefundSubmitting(false);
    }
  };

  return (
    <div className={`admin-page-container ${embedded ? 'admin-page-embedded' : ''}`} data-testid="admin-bookings-page">
      {!embedded && (
        <div className="admin-page-header">
          <div>
            <h2>Booking & Payment Oversight</h2>
            <p className="text-muted">
              Administrative management for reservations, payment statuses, and reconciliation queues.
            </p>
          </div>
        </div>
      )}

      {/* Primary Tabs */}
      <div className="admin-tab-nav" role="tablist">
        <button
          className={`tab-btn ${activeTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setActiveTab('bookings')}
          role="tab"
          aria-selected={activeTab === 'bookings'}
          data-testid="tab-all-bookings"
        >
          All Reservations ({bookingsPagination.total || 0})
        </button>
        <button
          className={`tab-btn ${activeTab === 'reconciliation' ? 'active' : ''}`}
          onClick={() => setActiveTab('reconciliation')}
          role="tab"
          aria-selected={activeTab === 'reconciliation'}
          data-testid="tab-reconciliations"
        >
          Payment Reconciliation Queue ({reconciliationsPagination.total || 0})
        </button>
      </div>

      {/* Tab 1: All Bookings */}
      {activeTab === 'bookings' && (
        <div className="admin-tab-content">
          {/* Filter Bar */}
          <div className="admin-filters-bar">
            <form onSubmit={handleSearchSubmit} className="search-form">
              <input
                type="text"
                placeholder="Search reference, guest name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input search-input"
                data-testid="admin-search-input"
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Search
              </button>
            </form>

            <div className="status-filter-wrapper">
              <label htmlFor="adminStatusFilter" className="filter-label">Status:</label>
              <select
                id="adminStatusFilter"
                value={bookingFilterStatus}
                onChange={(e) => {
                  setBookingFilterStatus(e.target.value);
                }}
                className="form-input form-select"
                data-testid="admin-status-filter"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="checked_in">Checked In</option>
                <option value="checked_out">Checked Out</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Bookings Table / Content */}
          {bookingsLoading ? (
            <div className="loading-state" data-testid="admin-bookings-loading">
              <div className="spinner" />
              <p>Loading reservations...</p>
            </div>
          ) : bookingsError ? (
            <div className="alert alert-error" data-testid="admin-bookings-error">
              <p>{bookingsError}</p>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchBookings(1)}>
                Retry
              </button>
            </div>
          ) : bookings.length === 0 ? (
            <div className="empty-state" data-testid="admin-bookings-empty">
              <p>No reservations found matching the current criteria.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table" data-testid="admin-bookings-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Guest</th>
                    <th>Room & Hotel</th>
                    <th>Dates</th>
                    <th>Amount</th>
                    <th>Booking Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b._id}>
                      <td className="font-mono font-bold">
                        {formatBookingReference(b._id)}
                      </td>
                      <td>
                        <div className="guest-info">
                          <span className="guest-name">{b.guest?.name || b.user?.name || 'Guest'}</span>
                          <span className="guest-email text-muted text-sm">{b.guest?.email || b.user?.email || 'N/A'}</span>
                        </div>
                      </td>
                      <td>
                        <div>
                          <span>{b.room?.type ? `${b.room.type} #${b.room.roomNumber}` : 'Room'}</span>
                          <span className="text-muted text-sm block">{b.hotel?.name || 'Hotel'}</span>
                        </div>
                      </td>
                      <td className="text-sm">
                        <div>In: {b.checkIn ? new Date(b.checkIn).toLocaleDateString() : 'N/A'}</div>
                        <div>Out: {b.checkOut ? new Date(b.checkOut).toLocaleDateString() : 'N/A'}</div>
                      </td>
                      <td className="font-mono font-bold">
                        {b.currency || 'USD'} {Number(b.totalAmount || 0).toFixed(2)}
                      </td>
                      <td>
                        <span className={`status-pill status-${b.status}`}>
                          {b.status}
                        </span>
                      </td>
                      <td>
                        {b.payment ? (
                          <div className="payment-cell">
                            <PaymentStatusBadge status={b.payment.status} />
                            {b.payment.refund && (
                              <span className="refund-badge text-xs">
                                Refund: {b.payment.refund.status}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted text-sm">No record</span>
                        )}
                      </td>
                      <td className="actions-cell">
                        <Link
                          to={`/my-bookings/${b._id}`}
                          className="btn btn-secondary btn-xs"
                          title="View Details"
                        >
                          View
                        </Link>
                        {b.payment && (b.payment.id || b.payment._id) && (
                          <Link
                            to={`/payments/${b.payment.id || b.payment._id}/receipt`}
                            className="btn btn-secondary btn-xs"
                            title="View Receipt"
                          >
                            Receipt
                          </Link>
                        )}
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            setSelectedBookingForStatus(b);
                            setNewStatus(b.status);
                            setStatusReason('');
                            setStatusError(null);
                          }}
                          title="Update Status"
                        >
                          Status
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {bookingsPagination.totalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={bookingsPagination.page <= 1}
                    onClick={() => fetchBookings(bookingsPagination.page - 1)}
                  >
                    Previous
                  </button>
                  <span className="page-indicator">
                    Page {bookingsPagination.page} of {bookingsPagination.totalPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={bookingsPagination.page >= bookingsPagination.totalPages}
                    onClick={() => fetchBookings(bookingsPagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Reconciliation Queue */}
      {activeTab === 'reconciliation' && (
        <div className="admin-tab-content">
          <div className="section-intro-box">
            <p>
              The payment reconciliation queue lists payment records flagged with anomalies,
              cancellations after completed payments, or late webhook arrivals that require administrative inspection or refund action.
            </p>
          </div>

          {reconciliationsLoading ? (
            <div className="loading-state" data-testid="admin-reconciliations-loading">
              <div className="spinner" />
              <p>Loading reconciliation records...</p>
            </div>
          ) : reconciliationsError ? (
            <div className="alert alert-error" data-testid="admin-reconciliations-error">
              <p>{reconciliationsError}</p>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchReconciliations(1)}>
                Retry
              </button>
            </div>
          ) : reconciliations.length === 0 ? (
            <div className="empty-state" data-testid="admin-reconciliations-empty">
              <p>No reconciliation anomalies currently pending. All payments are balanced.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table" data-testid="admin-reconciliation-table">
                <thead>
                  <tr>
                    <th>Payment ID / Tx</th>
                    <th>Booking Ref</th>
                    <th>Amount</th>
                    <th>Payment Status</th>
                    <th>Reconciliation Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliations.map((rec) => {
                    const payId = rec.id || rec._id;
                    const bookingId = rec.booking?._id || rec.booking;
                    const reason =
                      rec.metadata?.reconciliationReason ||
                      rec.reconciliationReason ||
                      'Anomalous state flagged';
                    const isRefundEligible =
                      rec.status === 'completed' &&
                      (!rec.refund || rec.refund.status === 'failed');

                    return (
                      <tr key={payId}>
                        <td>
                          <div className="font-mono font-bold text-sm">{payId}</div>
                          {rec.transactionId && (
                            <span className="text-muted text-xs font-mono">{rec.transactionId}</span>
                          )}
                        </td>
                        <td className="font-mono">
                          {bookingId ? (
                            <Link to={`/my-bookings/${bookingId}`} className="table-link">
                              {formatBookingReference(String(bookingId))}
                            </Link>
                          ) : (
                            'N/A'
                          )}
                        </td>
                        <td className="font-mono font-bold">
                          {rec.currency?.toUpperCase() || 'USD'} {Number(rec.amount || 0).toFixed(2)}
                        </td>
                        <td>
                          <PaymentStatusBadge status={rec.status} />
                        </td>
                        <td>
                          <span className="reconciliation-reason-text">
                            {reason}
                          </span>
                        </td>
                        <td>
                          {isRefundEligible ? (
                            <button
                              className="btn btn-warning btn-xs"
                              onClick={() => {
                                setRefundTarget(rec);
                                setRefundReason(`Refund for reconciliation: ${reason}`);
                                setRefundError(null);
                              }}
                              data-testid={`refund-btn-${payId}`}
                            >
                              Issue Refund
                            </button>
                          ) : (
                            <span className="text-muted text-xs">
                              {rec.status === 'refunded' ? 'Refunded' : 'Reviewed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {reconciliationsPagination.totalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={reconciliationsPagination.page <= 1}
                    onClick={() => fetchReconciliations(reconciliationsPagination.page - 1)}
                  >
                    Previous
                  </button>
                  <span className="page-indicator">
                    Page {reconciliationsPagination.page} of {reconciliationsPagination.totalPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={reconciliationsPagination.page >= reconciliationsPagination.totalPages}
                    onClick={() => fetchReconciliations(reconciliationsPagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status Update Modal */}
      {selectedBookingForStatus && (
        <div className="modal-backdrop" data-testid="status-modal-backdrop">
          <div className="modal-card">
            <h3>Update Reservation Status</h3>
            <p className="text-muted">
              Booking Ref: <strong>{formatBookingReference(selectedBookingForStatus._id)}</strong>
            </p>

            {statusError && (
              <div className="alert alert-error text-sm">{statusError}</div>
            )}

            <form onSubmit={handleStatusUpdateSubmit}>
              <div className="form-group">
                <label htmlFor="newStatusSelect">Target Status</label>
                <select
                  id="newStatusSelect"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="form-input form-select"
                  disabled={statusSubmitting}
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="checked_in">Checked In</option>
                  <option value="checked_out">Checked Out</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="statusReasonInput">Audit / State Change Reason (Optional)</label>
                <input
                  id="statusReasonInput"
                  type="text"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="e.g. Guest checked in at front desk"
                  className="form-input"
                  disabled={statusSubmitting}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedBookingForStatus(null)}
                  disabled={statusSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={statusSubmitting}
                  data-testid="confirm-status-update-btn"
                >
                  {statusSubmitting ? 'Updating...' : 'Confirm Status Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Refund Confirmation Modal */}
      {refundTarget && (
        <div className="modal-backdrop" data-testid="refund-modal-backdrop">
          <div className="modal-card">
            <h3 className="text-warning">Confirm Administrative Refund</h3>
            <p>
              Are you sure you want to process a refund for payment{' '}
              <strong>{refundTarget.id || refundTarget._id}</strong>?
            </p>
            <div className="alert alert-info text-sm">
              <p>
                <strong>Refund Amount:</strong>{' '}
                {refundTarget.currency?.toUpperCase() || 'USD'}{' '}
                {Number(refundTarget.amount || 0).toFixed(2)}
              </p>
              <p>
                This action will trigger an authenticated refund request to the underlying payment provider.
              </p>
            </div>

            {refundError && (
              <div className="alert alert-error text-sm">{refundError}</div>
            )}

            <form onSubmit={handleRefundSubmit}>
              <div className="form-group">
                <label htmlFor="refundReasonInput">Refund Reason</label>
                <input
                  id="refundReasonInput"
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="form-input"
                  required
                  disabled={refundSubmitting}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRefundTarget(null)}
                  disabled={refundSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-warning"
                  disabled={refundSubmitting}
                  data-testid="confirm-refund-btn"
                >
                  {refundSubmitting ? 'Processing Refund...' : 'Execute Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminBookingsPage;
