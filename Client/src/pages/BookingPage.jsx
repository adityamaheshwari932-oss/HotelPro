import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context';
import { apiClient, ApiError } from '../api/client';
import { formatRoomType } from '../utils/roomFormatters';
import { getTodayIso, getTomorrowIso } from '../utils/roomSearchValidation';
import { validateBookingForm, formatDateDisplay } from '../utils/bookingUtils';

export const BookingPage = () => {
  const { roomId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Search/stay parameters
  const checkInDateParam = searchParams.get('checkInDate') || getTodayIso();
  const checkOutDateParam = searchParams.get('checkOutDate') || getTomorrowIso();
  const guestsParam = searchParams.get('guests') || '1';

  // Room & pricing state
  const [room, setRoom] = useState(null);
  const [pricingQuote, setPricingQuote] = useState(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(true);
  const [isQuotingPrice, setIsQuotingPrice] = useState(false);
  const [roomError, setRoomError] = useState('');

  // Form input state (pre-filled with authenticated user info)
  const [formData, setFormData] = useState({
    checkInDate: checkInDateParam,
    checkOutDate: checkOutDateParam,
    guestCount: guestsParam,
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);


  // 1. Fetch Room Details
  useEffect(() => {
    let isCancelled = false;

    const fetchRoom = async () => {
      setIsLoadingRoom(true);
      setRoomError('');

      try {
        const response = await apiClient.get(`/rooms/${roomId}`);
        if (!isCancelled) {
          const roomData = response?.data?.room;
          if (!roomData) {
            setRoomError('Room details not found.');
          } else if (roomData.status !== 'active') {
            setRoomError(`This room is currently ${roomData.status} and cannot be reserved.`);
          } else {
            setRoom(roomData);
          }
          setIsLoadingRoom(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setIsLoadingRoom(false);
          if (err instanceof ApiError) {
            setRoomError(err.message || 'Room not found.');
          } else {
            setRoomError('Unable to load room details. Please check your network connection.');
          }
        }
      }
    };

    if (roomId) {
      fetchRoom();
    }

    return () => {
      isCancelled = true;
    };
  }, [roomId]);

  // 2. Fetch Authoritative Stay Pricing Quote
  useEffect(() => {
    let isCancelled = false;

    const fetchQuote = async () => {
      if (!formData.checkInDate || !formData.checkOutDate) return;
      if (formData.checkOutDate <= formData.checkInDate) return;

      setIsQuotingPrice(true);
      try {
        const searchRes = await apiClient.get('/rooms/search', {
          params: {
            checkInDate: formData.checkInDate,
            checkOutDate: formData.checkOutDate
          }
        });

        if (!isCancelled && searchRes?.data?.rooms) {
          const matched = searchRes.data.rooms.find((r) => r._id === roomId);
          if (matched && matched.pricing) {
            setPricingQuote(matched.pricing);
          } else {
            // Room might be temporarily held or booked
            setPricingQuote(null);
          }
        }
      } catch {
        // Non-fatal: final price snapshot is authoritative at booking creation time
      } finally {
        if (!isCancelled) {
          setIsQuotingPrice(false);
        }
      }
    };

    if (room && formData.checkInDate && formData.checkOutDate) {
      fetchQuote();
    }

    return () => {
      isCancelled = true;
    };
  }, [room, roomId, formData.checkInDate, formData.checkOutDate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (submitError) {
      setSubmitError('');
    }

    // If changing stay dates or guest count, update URL query parameters for consistency
    if (name === 'checkInDate' || name === 'checkOutDate' || name === 'guestCount') {
      const newParams = new URLSearchParams(searchParams);
      newParams.set(name === 'guestCount' ? 'guests' : name, value);
      setSearchParams(newParams, { replace: true });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    // Pre-flight client-side validation
    const { isValid, errors } = validateBookingForm(formData, room?.capacity);
    setFormErrors(errors);

    if (!isValid) {
      return;
    }

    setIsSubmitting(true);

    const payload = {
      room: roomId,
      checkInDate: formData.checkInDate,
      checkOutDate: formData.checkOutDate,
      guestCount: parseInt(formData.guestCount, 10),
      guestInfo: {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim()
      }
    };

    try {
      const response = await apiClient.post('/bookings', payload);

      if (response?.data?.booking?._id) {
        // Navigate to the reservation hold confirmation page
        navigate(`/bookings/${response.data.booking._id}`, {
          state: { newBooking: true }
        });
      } else {
        throw new Error('Booking response was missing reservation identifier.');
      }
    } catch (err) {
      setIsSubmitting(false);

      if (err instanceof ApiError) {
        if (err.status === 409) {
          setSubmitError(
            'The requested room is no longer available for your selected dates. It may have just been reserved by another guest.'
          );
        } else if (err.status === 401) {
          setSubmitError('Your session has expired. Please log in again to complete your booking.');
        } else {
          setSubmitError(err.message || 'Failed to create reservation. Please review your details.');
        }
      } else {
        setSubmitError('Unable to connect to the reservation service. Please check your network and try again.');
      }
    }
  };

  if (isLoadingRoom) {
    return (
      <div className="booking-page-container">
        <div className="auth-loading-container" role="status" aria-live="polite">
          <div className="auth-spinner" aria-hidden="true"></div>
          <p>Preparing room reservation details...</p>
        </div>
      </div>
    );
  }

  if (roomError) {
    return (
      <div className="booking-page-container">
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <h3>Unable to Proceed with Booking</h3>
            <p>{roomError}</p>
            <div className="alert-actions">
              <Link to="/rooms" className="btn-secondary">
                ← Return to Room Search
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const roomTypeLabel = formatRoomType(room?.roomType);
  const hotelName = room?.hotel?.name || 'HotelPro Property';
  const hotelAddress = room?.hotel?.address || '';

  return (
    <div className="booking-page-container">
      <div className="booking-header">
        <nav className="breadcrumb-nav" aria-label="Breadcrumb">
          <Link to="/rooms" className="breadcrumb-link">Rooms</Link>
          <span className="breadcrumb-sep">/</span>
          <Link to={`/rooms/${roomId}`} className="breadcrumb-link">Room {room?.roomNumber}</Link>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-current">Reserve Hold</span>
        </nav>
        <h1>Confirm Your Reservation Hold</h1>
        <p className="booking-subtitle">
          Place a 15-minute exclusive hold on this room. Dates and pricing are guaranteed by HotelPro.
        </p>
      </div>

      {submitError && (
        <div className="alert-error" role="alert" aria-live="assertive">
          <span className="alert-icon">⚠️</span>
          <div className="alert-body">
            <p className="alert-message">{submitError}</p>
            {submitError.includes('no longer available') && (
              <div className="alert-actions">
                <Link
                  to={`/rooms?checkInDate=${formData.checkInDate}&checkOutDate=${formData.checkOutDate}&guests=${formData.guestCount}`}
                  className="btn-link-action"
                >
                  🔍 Search Other Available Rooms for These Dates →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="booking-layout-grid">
        {/* Left Column: Guest Details & Stay Parameters Form */}
        <div className="booking-form-card">
          <form onSubmit={handleSubmit} noValidate className="reservation-form">
            <section className="form-section">
              <h2>1. Stay Dates & Occupancy</h2>
              <div className="form-row-grid">
                <div className="form-group">
                  <label htmlFor="booking-checkin">Check-in Date *</label>
                  <input
                    id="booking-checkin"
                    name="checkInDate"
                    type="date"
                    required
                    disabled={isSubmitting}
                    value={formData.checkInDate}
                    onChange={handleChange}
                    min={getTodayIso()}
                    className={formErrors.checkInDate ? 'input-error' : ''}
                    aria-invalid={!!formErrors.checkInDate}
                    aria-describedby={formErrors.checkInDate ? 'booking-checkin-error' : undefined}
                  />
                  {formErrors.checkInDate && (
                    <span id="booking-checkin-error" className="field-error-message">
                      {formErrors.checkInDate}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="booking-checkout">Check-out Date *</label>
                  <input
                    id="booking-checkout"
                    name="checkOutDate"
                    type="date"
                    required
                    disabled={isSubmitting}
                    value={formData.checkOutDate}
                    onChange={handleChange}
                    min={formData.checkInDate || getTodayIso()}
                    className={formErrors.checkOutDate ? 'input-error' : ''}
                    aria-invalid={!!formErrors.checkOutDate}
                    aria-describedby={formErrors.checkOutDate ? 'booking-checkout-error' : undefined}
                  />
                  {formErrors.checkOutDate && (
                    <span id="booking-checkout-error" className="field-error-message">
                      {formErrors.checkOutDate}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="booking-guests">Number of Guests *</label>
                  <input
                    id="booking-guests"
                    name="guestCount"
                    type="number"
                    min="1"
                    max={room?.capacity || 10}
                    required
                    disabled={isSubmitting}
                    value={formData.guestCount}
                    onChange={handleChange}
                    className={formErrors.guestCount ? 'input-error' : ''}
                    aria-invalid={!!formErrors.guestCount}
                    aria-describedby={formErrors.guestCount ? 'booking-guests-error' : undefined}
                  />
                  {formErrors.guestCount && (
                    <span id="booking-guests-error" className="field-error-message">
                      {formErrors.guestCount}
                    </span>
                  )}
                  <small className="field-help">Room capacity: up to {room?.capacity} guests</small>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>2. Primary Guest Information</h2>
              <p className="section-note">
                Pre-filled from your profile. You may modify guest contact details for this specific reservation.
              </p>

              <div className="form-group">
                <label htmlFor="booking-name">Full Name *</label>
                <input
                  id="booking-name"
                  name="name"
                  type="text"
                  required
                  disabled={isSubmitting}
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. John Doe"
                  className={formErrors.name ? 'input-error' : ''}
                  aria-invalid={!!formErrors.name}
                  aria-describedby={formErrors.name ? 'booking-name-error' : undefined}
                />
                {formErrors.name && (
                  <span id="booking-name-error" className="field-error-message">
                    {formErrors.name}
                  </span>
                )}
              </div>

              <div className="form-row-grid">
                <div className="form-group">
                  <label htmlFor="booking-email">Email Address *</label>
                  <input
                    id="booking-email"
                    name="email"
                    type="email"
                    required
                    disabled={isSubmitting}
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="e.g. john@example.com"
                    className={formErrors.email ? 'input-error' : ''}
                    aria-invalid={!!formErrors.email}
                    aria-describedby={formErrors.email ? 'booking-email-error' : undefined}
                  />
                  {formErrors.email && (
                    <span id="booking-email-error" className="field-error-message">
                      {formErrors.email}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="booking-phone">Phone Number (Optional)</label>
                  <input
                    id="booking-phone"
                    name="phone"
                    type="tel"
                    disabled={isSubmitting}
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+1 555-0199"
                  />
                </div>
              </div>
            </section>

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary btn-submit-booking"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="btn-loading-content">
                    <span className="spinner-small" aria-hidden="true"></span>
                    <span>Creating Reservation Hold...</span>
                  </span>
                ) : (
                  '🔒 Place 15-Minute Reservation Hold'
                )}
              </button>
              <p className="hold-disclaimer">
                No immediate payment required. A 15-minute hold guarantees your room and rates against other bookings.
              </p>
            </div>
          </form>
        </div>

        {/* Right Column: Authoritative Booking Review Sidebar */}
        <aside className="booking-summary-sidebar" aria-label="Reservation Summary">
          <div className="summary-card">
            <h3>Reservation Summary</h3>

            <div className="summary-room-header">
              <span className="summary-room-type">{roomTypeLabel}</span>
              <h4 className="summary-room-number">Room {room?.roomNumber}</h4>
              <p className="summary-hotel-name">{hotelName}</p>
              {hotelAddress && <p className="summary-hotel-address">{hotelAddress}</p>}
            </div>

            <div className="summary-dates-box">
              <div className="summary-date-item">
                <span className="date-item-label">Check-in</span>
                <span className="date-item-val">{formatDateDisplay(formData.checkInDate)}</span>
              </div>
              <div className="summary-date-sep">→</div>
              <div className="summary-date-item">
                <span className="date-item-label">Check-out</span>
                <span className="date-item-val">{formatDateDisplay(formData.checkOutDate)}</span>
              </div>
            </div>

            <div className="summary-specs-list">
              <div className="summary-spec-row">
                <span>Guests:</span>
                <strong>{formData.guestCount} {parseInt(formData.guestCount, 10) === 1 ? 'Guest' : 'Guests'}</strong>
              </div>
              {pricingQuote && (
                <div className="summary-spec-row">
                  <span>Duration:</span>
                  <strong>{pricingQuote.nights} {pricingQuote.nights === 1 ? 'night' : 'nights'}</strong>
                </div>
              )}
            </div>

            <div className="summary-pricing-section">
              <h4>Authoritative Price Snapshot</h4>
              {isQuotingPrice ? (
                <div className="pricing-loading-indicator">
                  <span className="spinner-small" aria-hidden="true"></span>
                  <span>Fetching live price quote...</span>
                </div>
              ) : pricingQuote ? (
                <div>
                  <div className="summary-total-row">
                    <span className="total-label">Total Stay Price:</span>
                    <div className="total-val">
                      <span className="currency-symbol">$</span>
                      <span className="amount-bold">{pricingQuote.totalRoomPrice}</span>
                      <span className="currency-code">{pricingQuote.currency || 'USD'}</span>
                    </div>
                  </div>

                  {Array.isArray(pricingQuote.nightlyBreakdown) && pricingQuote.nightlyBreakdown.length > 0 && (
                    <div className="summary-nightly-breakdown">
                      <span className="breakdown-title">Nightly Rates:</span>
                      {pricingQuote.nightlyBreakdown.map((item) => (
                        <div key={item.date} className="breakdown-row">
                          <span>{item.date}</span>
                          <strong>
                            ${item.rate}
                            {item.ruleApplied && <span className="rate-rule-pill">*</span>}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="summary-base-rate-box">
                  <div className="summary-total-row">
                    <span className="total-label">Base Rate:</span>
                    <span className="amount-bold">${room?.basePrice} / night</span>
                  </div>
                  <small className="pricing-disclaimer">
                    Final stay price snapshot will be atomically confirmed upon creating the hold.
                  </small>
                </div>
              )}
            </div>

            <div className="summary-guarantee-box">
              <span className="guarantee-icon">🛡️</span>
              <div>
                <strong>Concurrency Protected</strong>
                <p>
                  HotelPro uses distributed locks to prevent double-booking. Your room is exclusively locked upon hold creation.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default BookingPage;
