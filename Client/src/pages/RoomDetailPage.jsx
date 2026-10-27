import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { apiClient, ApiError } from '../api/client';
import { formatRoomType } from '../utils/roomFormatters';

export const RoomDetailPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const checkInDate = searchParams.get('checkInDate') || '';
  const checkOutDate = searchParams.get('checkOutDate') || '';
  const guests = searchParams.get('guests') || '1';

  const [room, setRoom] = useState(null);
  const [stayPricing, setStayPricing] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    const fetchRoom = async () => {
      setIsLoading(true);
      setErrorStatus(null);
      setErrorMessage('');

      try {
        const response = await apiClient.get(`/rooms/${id}`);
        if (!isCancelled) {
          const roomData = response?.data?.room;
          setRoom(roomData);

          // If stay dates were passed from search, also fetch dynamic stay pricing
          if (checkInDate && checkOutDate) {
            try {
              const searchRes = await apiClient.get('/rooms/search', {
                params: {
                  checkInDate,
                  checkOutDate
                }
              });
              if (!isCancelled && searchRes?.data?.rooms) {
                const matched = searchRes.data.rooms.find((r) => r._id === id);
                if (matched && matched.pricing) {
                  setStayPricing(matched.pricing);
                }
              }
            } catch {
              // Non-fatal: if stay pricing calculation fails, base price remains available
            }
          }

          setIsLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setIsLoading(false);
          if (err instanceof ApiError) {
            setErrorStatus(err.status);
            setErrorMessage(err.message || 'Room not found.');
          } else {
            setErrorStatus(500);
            setErrorMessage('Unable to load room details. Please check your network connection.');
          }
        }
      }
    };

    fetchRoom();

    return () => {
      isCancelled = true;
    };
  }, [id, checkInDate, checkOutDate]);

  if (isLoading) {
    return (
      <div className="room-detail-loading" role="status" aria-live="polite">
        <div className="auth-spinner" aria-hidden="true"></div>
        <p>Loading room details...</p>
      </div>
    );
  }

  if (errorStatus === 404 || errorStatus === 400) {
    return (
      <div className="room-not-found-container">
        <div className="room-not-found-card">
          <span className="not-found-icon">🔍</span>
          <h2>Room Not Found</h2>
          <p>{errorMessage || 'The requested room does not exist or may have been unlisted.'}</p>
          <Link to="/rooms" className="btn-primary">
            ← Back to Room Search
          </Link>
        </div>
      </div>
    );
  }

  if (errorStatus || !room) {
    return (
      <div className="room-detail-error">
        <div className="alert-error" role="alert">
          <span className="alert-icon">⚠️</span>
          <span className="alert-message">{errorMessage || 'An error occurred loading room details.'}</span>
        </div>
        <Link to="/rooms" className="btn-secondary">
          ← Return to Rooms
        </Link>
      </div>
    );
  }

  const roomTypeLabel = formatRoomType(room.roomType);
  const photos = Array.isArray(room.photos) ? room.photos : [];
  const currentPhoto = photos.length > 0 ? photos[selectedPhotoIndex] : null;

  return (
    <div className="room-detail-page">
      <nav className="detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/rooms">Rooms</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Room {room.roomNumber}</span>
      </nav>

      <div className="room-detail-grid">
        {/* Left Column: Gallery & Details */}
        <div className="detail-main-column">
          <div className="detail-gallery">
            <div className="main-photo-frame">
              {currentPhoto ? (
                <img
                  src={currentPhoto}
                  alt={`${roomTypeLabel} Room ${room.roomNumber}`}
                  className="main-photo"
                />
              ) : (
                <div className="main-photo-fallback">
                  <span className="fallback-large-icon">🏨</span>
                  <span>{roomTypeLabel}</span>
                </div>
              )}
            </div>

            {photos.length > 1 && (
              <div className="photo-thumbnails" role="tablist" aria-label="Room photos">
                {photos.map((photo, index) => (
                  <button
                    key={photo}
                    type="button"
                    role="tab"
                    aria-selected={index === selectedPhotoIndex}
                    className={`thumb-btn ${index === selectedPhotoIndex ? 'thumb-active' : ''}`}
                    onClick={() => setSelectedPhotoIndex(index)}
                  >
                    <img src={photo} alt={`Thumbnail ${index + 1}`} className="thumb-img" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="detail-info-card">
            <div className="detail-title-row">
              <div>
                <h1 className="detail-room-title">
                  {roomTypeLabel} — Room {room.roomNumber}
                </h1>
                <p className="detail-hotel-location">
                  🏨 {room.hotel?.name || 'HotelPro Property'}
                  {room.hotel?.address ? ` • ${room.hotel.address}` : ''}
                </p>
              </div>
              <span className={`status-badge status-${room.status}`}>
                {room.status === 'active' ? 'Operational' : room.status}
              </span>
            </div>

            <div className="specs-bar">
              <div className="spec-item">
                <span className="spec-label">Capacity</span>
                <span className="spec-val">👤 Up to {room.capacity} Guests</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Room Type</span>
                <span className="spec-val">🏷️ {roomTypeLabel}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Standard Rate</span>
                <span className="spec-val">💵 ${room.basePrice} / night</span>
              </div>
            </div>

            <div className="detail-description-section">
              <h3>Description</h3>
              <p className="description-text">
                {room.description ||
                  `Experience a refined stay in our ${roomTypeLabel.toLowerCase()}. Designed with elegant furnishings, climate control, premium bedding, and generous space for business or leisure travelers.`}
              </p>
            </div>

            {room.hotel?.contact && (
              <div className="detail-contact-section">
                <h3>Hotel Contact</h3>
                <p>Phone / Inquiries: {room.hotel.contact}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Pricing & Availability Sidebar */}
        <aside className="detail-sidebar" aria-label="Stay Pricing and Reservation">
          <div className="sidebar-booking-card">
            <div className="sidebar-price-header">
              {stayPricing ? (
                <div>
                  <span className="sidebar-total-label">
                    Stay Total ({stayPricing.nights} {stayPricing.nights === 1 ? 'night' : 'nights'}):
                  </span>
                  <div className="sidebar-price-number">
                    <span className="currency-symbol">$</span>
                    <span className="price-bold">{stayPricing.totalRoomPrice}</span>
                    <span className="currency-code">{stayPricing.currency || 'USD'}</span>
                  </div>
                  <span className="sidebar-avg-nightly">
                    Average ~${Math.round(stayPricing.totalRoomPrice / stayPricing.nights)} / night
                  </span>
                </div>
              ) : (
                <div>
                  <span className="sidebar-total-label">Standard Base Rate:</span>
                  <div className="sidebar-price-number">
                    <span className="currency-symbol">$</span>
                    <span className="price-bold">{room.basePrice}</span>
                    <span className="currency-code">/ night</span>
                  </div>
                </div>
              )}
            </div>

            <div className="sidebar-stay-details">
              <h4>Stay Parameters</h4>
              {checkInDate && checkOutDate ? (
                <div className="selected-dates-summary">
                  <div className="date-summary-row">
                    <span>Check-in:</span>
                    <strong>{checkInDate}</strong>
                  </div>
                  <div className="date-summary-row">
                    <span>Check-out:</span>
                    <strong>{checkOutDate}</strong>
                  </div>
                  <div className="date-summary-row">
                    <span>Guests:</span>
                    <strong>{guests}</strong>
                  </div>
                </div>
              ) : (
                <p className="no-dates-note">
                  No stay dates selected yet. Availability and pricing are date-specific.
                </p>
              )}
            </div>

            {stayPricing?.nightlyBreakdown && (
              <div className="sidebar-nightly-list">
                <h5>Transparent Nightly Breakdown</h5>
                {stayPricing.nightlyBreakdown.map((item) => (
                  <div key={item.date} className="sidebar-breakdown-row">
                    <span>{item.date}</span>
                    <strong>
                      ${item.rate}
                      {item.ruleApplied && (
                        <span className="rate-rule-pill" title={`Applied: ${item.ruleApplied}`}>
                          *
                        </span>
                      )}
                    </strong>
                  </div>
                ))}
              </div>
            )}

            <div className="sidebar-notice">
              <span className="notice-icon">ℹ️</span>
              <p>
                Availability is dynamically reserved upon creating a reservation hold. No double-bookings guaranteed by the HotelPro locking engine.
              </p>
            </div>

            <div className="sidebar-actions">
              {checkInDate && checkOutDate ? (
                <>
                  <Link
                    to={`/book/${room._id}?checkInDate=${encodeURIComponent(checkInDate)}&checkOutDate=${encodeURIComponent(checkOutDate)}&guests=${encodeURIComponent(guests)}`}
                    className="btn-primary-block btn-reserve-hold-action"
                  >
                    🔒 Reserve Room Hold (15 Mins) →
                  </Link>
                  <Link
                    to={`/rooms?checkInDate=${encodeURIComponent(checkInDate)}&checkOutDate=${encodeURIComponent(checkOutDate)}&guests=${encodeURIComponent(guests)}`}
                    className="btn-secondary-block"
                  >
                    🔍 Search More Rooms for These Dates
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to={`/book/${room._id}?guests=${encodeURIComponent(guests)}`}
                    className="btn-primary-block"
                  >
                    📅 Select Dates & Reserve Room →
                  </Link>
                  <Link to="/rooms" className="btn-secondary-block">
                    🔍 Search All Available Rooms
                  </Link>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default RoomDetailPage;
