import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMyBookings } from '../api/bookingApi';
import { ApiError } from '../api/client';
import {
  formatDateDisplay,
  formatBookingStatus,
  formatPaymentStatus,
  formatCurrency,
  calculateRemainingHoldTime
} from '../utils/bookingUtils';
import { formatRoomType } from '../utils/roomFormatters';

export const MyBookingsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'all';
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const currentPage = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  const [bookings, setBookings] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorStatus, setErrorStatus] = useState(null);

  const isMountedRef = useRef(true);

  const fetchBookings = useCallback(
    async (tab, page) => {
      await Promise.resolve();
      if (!isMountedRef.current) return;
      setIsLoading(true);
      setErrorMessage('');
      setErrorStatus(null);

      try {
        const queryParams = {
          page,
          limit: 10
        };

        if (tab !== 'all') {
          queryParams.timeFilter = tab;
        }

        const response = await getMyBookings(queryParams);

        if (!isMountedRef.current) return;

        if (response?.data?.bookings) {
          setBookings(response.data.bookings);
          setPagination(
            response.data.pagination || {
              total: response.data.bookings.length,
              page,
              limit: 10,
              totalPages: 1
            }
          );
        } else {
          setBookings([]);
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        if (err instanceof ApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message || 'Failed to retrieve your reservations.');
        } else {
          setErrorStatus(500);
          setErrorMessage('Unable to connect to reservation service. Please check your network.');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    isMountedRef.current = true;
    void Promise.resolve().then(() => {
      fetchBookings(activeTab, currentPage);
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchBookings, activeTab, currentPage]);

  const handleTabChange = (newTab) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', newTab);
    newParams.set('page', '1');
    setSearchParams(newParams);
  };

  const handlePageChange = (newPage) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', String(newPage));
    setSearchParams(newParams);
  };

  return (
    <div className="bookings-page-container" data-testid="my-bookings-page">
      <div className="bookings-page-header">
        <div>
          <span className="page-breadcrumb">
            <Link to="/profile">My Account</Link> / Bookings
          </span>
          <h1 className="bookings-page-title">My Room Reservations</h1>
          <p className="bookings-page-subtitle">
            Manage your past, active, and upcoming hotel room bookings.
          </p>
        </div>

        <Link to="/rooms" className="btn-primary" data-testid="explore-rooms-cta">
          Explore Available Rooms
        </Link>
      </div>

      {/* Tabs Filter Bar */}
      <div className="bookings-tabs-bar" role="tablist" aria-label="Filter bookings by stay timing">
        {[
          { key: 'all', label: 'All Stays' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'active', label: 'Active Stays' },
          { key: 'past', label: 'Past Stays' },
          { key: 'cancelled', label: 'Cancelled' }
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'tab-active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
            data-testid={`tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="auth-loading-container" role="status" aria-live="polite" data-testid="bookings-loading">
          <div className="auth-spinner" aria-hidden="true"></div>
          <p>Retrieving your bookings...</p>
        </div>
      )}

      {/* Error State */}
      {!isLoading && errorMessage && (
        <div className="alert-error" role="alert" data-testid="bookings-error">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <h3>Unable to Load Bookings {errorStatus ? `(${errorStatus})` : ''}</h3>
            <p>{errorMessage}</p>
            <button
              type="button"
              className="btn-secondary btn-retry"
              onClick={() => fetchBookings(activeTab, currentPage)}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !errorMessage && bookings.length === 0 && (
        <div className="bookings-empty-card" data-testid="bookings-empty">
          <span className="empty-emoji" aria-hidden="true">
            🛎️
          </span>
          <h2>No Reservations Found</h2>
          <p>
            {activeTab === 'all'
              ? "You haven't made any hotel reservations yet. Find a comfortable room for your next trip!"
              : `You have no ${activeTab} reservations matching this filter.`}
          </p>
          <div className="empty-actions">
            <Link to="/rooms" className="btn-primary">
              Search Available Rooms
            </Link>
            {activeTab !== 'all' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleTabChange('all')}
              >
                View All Stays
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bookings List */}
      {!isLoading && !errorMessage && bookings.length > 0 && (
        <div className="bookings-list" data-testid="bookings-list">
          {bookings.map((b) => {
            const room = b.room || {};
            const hotel = b.hotel || {};
            const holdInfo = calculateRemainingHoldTime(b.holdExpiresAt);
            const isHoldExpired = b.status === 'pending' && holdInfo.expired;
            const bStatus = formatBookingStatus(b.status, isHoldExpired);
            const pStatus = b.payment ? formatPaymentStatus(b.payment.status) : null;
            const nights = b.priceSnapshot?.nightlyBreakdown?.length || 1;

            return (
              <div key={b._id} className="booking-card" data-testid={`booking-card-${b._id}`}>
                <div className="booking-card-header">
                  <div>
                    <span className="booking-ref-label">Reservation Ref:</span>
                    <span className="booking-ref-val font-mono">{b._id}</span>
                  </div>
                  <div className="card-status-badges">
                    <span className={`booking-status-pill ${bStatus.variant}`}>
                      {bStatus.label}
                    </span>
                    {pStatus && (
                      <span className={`payment-status-badge ${pStatus.variant}`}>
                        {pStatus.label}
                      </span>
                    )}
                  </div>
                </div>

                <div className="booking-card-body">
                  <div className="card-hotel-info">
                    <span className="room-type-tag">{formatRoomType(room.roomType)}</span>
                    <h3 className="room-title">Room {room.roomNumber || 'N/A'}</h3>
                    <p className="hotel-title">{hotel.name || 'HotelPro Property'}</p>
                    {hotel.address && <p className="hotel-subaddress">{hotel.address}</p>}
                  </div>

                  <div className="card-stay-dates">
                    <div className="stay-box">
                      <span className="box-sub">Check-In</span>
                      <strong className="box-date">{formatDateDisplay(b.checkInDate)}</strong>
                    </div>
                    <span className="stay-arrow" aria-hidden="true">→</span>
                    <div className="stay-box">
                      <span className="box-sub">Check-Out</span>
                      <strong className="box-date">{formatDateDisplay(b.checkOutDate)}</strong>
                    </div>
                  </div>

                  <div className="card-financials">
                    <span className="financials-nights">
                      {nights} {nights === 1 ? 'night' : 'nights'} • {b.guestCount} {b.guestCount === 1 ? 'guest' : 'guests'}
                    </span>
                    <span className="financials-amount font-mono">
                      {formatCurrency(b.totalAmount, b.currency)}
                    </span>
                  </div>
                </div>

                <div className="booking-card-footer">
                  <div className="footer-left">
                    <span className="booked-timestamp">
                      Booked on {new Date(b.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="footer-actions">
                    {/* If pending and hold still active: prompt complete checkout */}
                    {b.status === 'pending' && !isHoldExpired && (
                      <Link
                        to={`/bookings/${b._id}`}
                        className="btn-primary-small"
                        data-testid={`pay-booking-${b._id}`}
                      >
                        Complete Payment
                      </Link>
                    )}

                    {/* View details */}
                    <Link
                      to={`/my-bookings/${b._id}`}
                      className="btn-secondary-small"
                      data-testid={`view-booking-${b._id}`}
                    >
                      View Details & Cancellation
                    </Link>

                    {/* Receipt link if payment completed */}
                    {b.payment && ['completed', 'refunded', 'partially_refunded'].includes(b.payment.status) && (
                      <Link
                        to={`/payments/${b.payment._id}/receipt`}
                        className="btn-receipt-small"
                        data-testid={`receipt-booking-${b._id}`}
                      >
                        🧾 Receipt
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && !errorMessage && pagination.totalPages > 1 && (
        <div className="pagination-bar" data-testid="bookings-pagination">
          <button
            type="button"
            className="btn-pagination"
            disabled={pagination.page <= 1}
            onClick={() => handlePageChange(pagination.page - 1)}
          >
            ← Previous
          </button>
          <span className="pagination-info">
            Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> (
            {pagination.total} total)
          </span>
          <button
            type="button"
            className="btn-pagination"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => handlePageChange(pagination.page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default MyBookingsPage;
