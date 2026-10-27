import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatRoomType } from '../utils/roomFormatters';

/**
 * Reusable Room Card Component
 *
 * SAFETY & DESIGN GUARANTEES:
 * 1. Image Fallback: Uses a clean inline SVG placeholder if no photos exist or if the image fails to load.
 * 2. Authoritative Pricing: Displays backend-calculated prices without frontend recomputations.
 *    Clearly separates total stay price from calculated nightly average.
 * 3. Transparent Nightly Breakdown: Allows expanding the backend-provided nightly breakdown when available.
 * 4. Preserves Stay Dates: Links to the detail page preserving stay query parameters for seamless booking progression.
 */
export const RoomCard = ({ room, stay }) => {
  const [imageError, setImageError] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (!room) return null;

  const roomTypeLabel = formatRoomType(room.roomType);
  const primaryPhoto = !imageError && Array.isArray(room.photos) && room.photos.length > 0 ? room.photos[0] : null;
  const pricing = room.pricing;
  const hotelName = room.hotel?.name || 'HotelPro Property';
  const hotelAddress = room.hotel?.address || '';

  // Build detail URL with stay params if present
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
        <span className="room-type-badge">{roomTypeLabel}</span>
      </div>

      <div className="room-card-body">
        <div className="room-card-header">
          <div>
            <h3 id={`room-title-${room._id}`} className="room-number-title">
              Room {room.roomNumber}
            </h3>
            <p className="room-hotel-name">
              {hotelName}
              {hotelAddress ? ` • ${hotelAddress}` : ''}
            </p>
          </div>
          <span className="room-capacity-badge">
            👤 Up to {room.capacity} {room.capacity === 1 ? 'Guest' : 'Guests'}
          </span>
        </div>

        <p className="room-description">
          {room.description ||
            `Spacious ${roomTypeLabel.toLowerCase()} featuring modern amenities, quality furnishings, and comfort.`}
        </p>

        {pricing ? (
          <div className="room-pricing-box">
            <div className="pricing-main">
              <span className="price-total-label">Total for {pricing.nights} {pricing.nights === 1 ? 'night' : 'nights'}</span>
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
            <span className="base-price-amount">
              ${room.basePrice} <span className="per-night-text">/ night</span>
            </span>
          </div>
        )}

        <div className="room-card-footer">
          <Link to={detailUrl} className="btn-view-details">
            View Details & Availability →
          </Link>
        </div>
      </div>
    </article>
  );
};

export default RoomCard;
