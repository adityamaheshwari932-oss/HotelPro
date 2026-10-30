import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRoomType } from '../utils/roomFormatters';

/**
 * Apple-Grade Luxury Room Card Component
 *
 * Visual & Functional Excellence:
 * 1. Image Presentation: 16:10 aspect ratio with smooth hover scale and frosted glass status pills.
 * 2. Authoritative Pricing: Transparently distinguishes stay total from average nightly rates.
 * 3. Nightly Breakdown: Expandable drawer with date-by-date rule visibility.
 * 4. Preservation of Query Parameters: Passes checkIn/checkOut and guests forward seamlessly.
 */
export const RoomCard = ({ room, stay }) => {
  const [imageError, setImageError] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (!room) return null;

  const roomTypeLabel = formatRoomType(room.roomType);
  const primaryPhoto = !imageError && Array.isArray(room.photos) && room.photos.length > 0 ? room.photos[0] : null;
  const pricing = room.pricing;
  const hotelName = room.hotel?.name || 'HotelPro Sanctuary';
  const hotelAddress = room.hotel?.address || 'Cupertino, CA';

  // Build detail URL preserving stay query parameters
  let detailUrl = `/rooms/${room._id}`;
  if (stay?.checkInDate && stay?.checkOutDate) {
    const params = new URLSearchParams({
      checkInDate: stay.checkInDate,
      checkOutDate: stay.checkOutDate
    });
    if (stay.guests) {
      params.append('guests', String(stay.guests));
    }
    detailUrl += `?${params.toString()}`;
  }

  return (
    <article className="room-card" aria-labelledby={`room-title-${room._id}`}>
      {/*  IMAGE CONTAINER WITH GLASS BADGES */}
      <div className="room-card-image-wrap">
        {primaryPhoto ? (
          <img
            src={primaryPhoto}
            alt={`${roomTypeLabel} Room ${room.roomNumber}`}
            className="room-card-image"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="room-card-image-fallback" aria-hidden="true">
            <span className="fallback-icon">🛏️</span>
            <span className="fallback-text">{roomTypeLabel}</span>
          </div>
        )}
        <div className="room-card-badges-top">
          <span className="room-type-badge">{roomTypeLabel}</span>
          <span className="room-capacity-badge">
            👤 Up to {room.capacity} {room.capacity === 1 ? 'Guest' : 'Guests'}
          </span>
        </div>
      </div>

      {/*  CARD BODY */}
      <div className="room-card-body">
        <div className="room-card-header">
          <div className="room-header-left">
            <h3 id={`room-title-${room._id}`} className="room-number-title">
              Room {room.roomNumber}
            </h3>
            <p className="room-hotel-name">
              {hotelName}
              {hotelAddress ? ` • ${hotelAddress}` : ''}
            </p>
          </div>
          <div className="room-status-indicator" title="Available for selected dates">
            <span className="status-dot-pulse"></span>
            <span className="status-text-available">Available</span>
          </div>
        </div>

        <p className="room-description">
          {room.description ||
            `Spacious ${roomTypeLabel.toLowerCase()} featuring modern amenities, quality furnishings, and comfort.`}
        </p>

        {pricing ? (
          <div className="room-pricing-box">
            <div className="pricing-main">
              <span className="price-total-label">
                Total for {pricing.nights} {pricing.nights === 1 ? 'night' : 'nights'}
              </span>
              <div className="price-total-amount">
                <span className="currency-symbol">$</span>
                <span className="total-value">{pricing.totalRoomPrice}</span>
                <span className="currency-code">{pricing.currency || 'USD'}</span>
              </div>
              <span className="price-per-night">
                Average ~${Math.round(pricing.totalRoomPrice / pricing.nights)} / night
              </span>
            </div>

            {Array.isArray(pricing.nightlyBreakdown) && pricing.nightlyBreakdown.length > 0 && (
              <div className="nightly-breakdown-toggle">
                <button
                  type="button"
                  className="btn-link-small"
                  onClick={() => setShowBreakdown((prev) => !prev)}
                  aria-expanded={showBreakdown}
                  aria-controls={`breakdown-${room._id}`}
                >
                  {showBreakdown ? 'Hide Nightly Rates ▲' : 'View Nightly Rates ▼'}
                </button>

                {showBreakdown && (
                  <div id={`breakdown-${room._id}`} className="nightly-breakdown-list">
                    {pricing.nightlyBreakdown.map((item) => (
                      <div key={item.date} className="nightly-breakdown-item">
                        <span className="night-date">{item.date}</span>
                        <span className="night-rate">
                          ${item.rate}
                          {item.ruleApplied && (
                            <span className="rate-rule-pill" title={`Applied rule: ${item.ruleApplied}`}>
                              {item.ruleApplied}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="room-base-pricing">
            <span className="base-price-label">Base nightly rate</span>
            <div className="base-price-wrap">
              <span className="base-price-amount">${room.basePrice}</span>
              <span className="per-night-text">/ night</span>
            </div>
          </div>
        )}

        <div className="room-card-footer">
          <Link to={detailUrl} className="btn-view-details">
            <span>View Sanctuary &amp; Reserve</span>
            <span className="btn-chevron">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
};

export default RoomCard;
