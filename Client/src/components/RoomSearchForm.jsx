import React, { useState } from 'react';
import {
  getTodayIso,
  getTomorrowIso,
  validateSearchParams
} from '../utils/roomSearchValidation';

export const RoomSearchForm = ({ onSearch, initialValues = {}, isLoading = false }) => {
  const [formData, setFormData] = useState({
    checkInDate: initialValues.checkInDate || getTodayIso(),
    checkOutDate: initialValues.checkOutDate || getTomorrowIso(),
    guests: initialValues.guests !== undefined ? initialValues.guests : '1',
    roomType: initialValues.roomType || '',
    minPrice: initialValues.minPrice || '',
    maxPrice: initialValues.maxPrice || ''
  });

  const [formErrors, setFormErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const { isValid, errors } = validateSearchParams(formData);
    setFormErrors(errors);

    if (isValid && typeof onSearch === 'function') {
      onSearch({
        checkInDate: formData.checkInDate,
        checkOutDate: formData.checkOutDate,
        guests: formData.guests ? parseInt(formData.guests, 10) : 1,
        roomType: formData.roomType || undefined,
        minPrice: formData.minPrice !== '' ? parseFloat(formData.minPrice) : undefined,
        maxPrice: formData.maxPrice !== '' ? parseFloat(formData.maxPrice) : undefined
      });
    }
  };

  return (
    <form className="room-search-form" onSubmit={handleSubmit} noValidate aria-label="Room search filters">
      <div className="search-form-header-bar">
        <span className="search-pill-label"> Concierge Engine</span>
        <span className="search-pill-desc">Instant availability scanning & dynamic price engine</span>
      </div>

      <div className="search-form-grid">
        <div className="search-field">
          <label htmlFor="search-checkin">Check-in Date *</label>
          <input
            id="search-checkin"
            name="checkInDate"
            type="date"
            required
            disabled={isLoading}
            value={formData.checkInDate}
            onChange={handleChange}
            min={getTodayIso()}
            className={formErrors.checkInDate ? 'input-error' : ''}
            aria-invalid={!!formErrors.checkInDate}
            aria-describedby={formErrors.checkInDate ? 'checkin-error' : undefined}
          />
          {formErrors.checkInDate && (
            <span id="checkin-error" className="field-error-message">
              {formErrors.checkInDate}
            </span>
          )}
        </div>

        <div className="search-field">
          <label htmlFor="search-checkout">Check-out Date *</label>
          <input
            id="search-checkout"
            name="checkOutDate"
            type="date"
            required
            disabled={isLoading}
            value={formData.checkOutDate}
            onChange={handleChange}
            min={formData.checkInDate || getTodayIso()}
            className={formErrors.checkOutDate ? 'input-error' : ''}
            aria-invalid={!!formErrors.checkOutDate}
            aria-describedby={formErrors.checkOutDate ? 'checkout-error' : undefined}
          />
          {formErrors.checkOutDate && (
            <span id="checkout-error" className="field-error-message">
              {formErrors.checkOutDate}
            </span>
          )}
        </div>

        <div className="search-field">
          <label htmlFor="search-guests">Guests</label>
          <input
            id="search-guests"
            name="guests"
            type="number"
            min="1"
            max="10"
            disabled={isLoading}
            value={formData.guests}
            onChange={handleChange}
            className={formErrors.guests ? 'input-error' : ''}
            aria-invalid={!!formErrors.guests}
            aria-describedby={formErrors.guests ? 'guests-error' : undefined}
          />
          {formErrors.guests && (
            <span id="guests-error" className="field-error-message">
              {formErrors.guests}
            </span>
          )}
        </div>

        <div className="search-field">
          <label htmlFor="search-roomtype">Room Type</label>
          <select
            id="search-roomtype"
            name="roomType"
            disabled={isLoading}
            value={formData.roomType}
            onChange={handleChange}
            className={formErrors.roomType ? 'input-error' : ''}
          >
            <option value="">All Sanctuaries</option>
            <option value="single">Single Suite</option>
            <option value="double">Double Suite</option>
            <option value="suite">Presidential Penthouse</option>
          </select>
          {formErrors.roomType && (
            <span className="field-error-message">{formErrors.roomType}</span>
          )}
        </div>

        <div className="search-field">
          <label htmlFor="search-minprice">Min Price ($)</label>
          <input
            id="search-minprice"
            name="minPrice"
            type="number"
            min="0"
            step="10"
            placeholder="Min $"
            disabled={isLoading}
            value={formData.minPrice}
            onChange={handleChange}
            className={formErrors.minPrice ? 'input-error' : ''}
            aria-invalid={!!formErrors.minPrice}
            aria-describedby={formErrors.minPrice ? 'minprice-error' : undefined}
          />
          {formErrors.minPrice && (
            <span id="minprice-error" className="field-error-message">
              {formErrors.minPrice}
            </span>
          )}
        </div>

        <div className="search-field">
          <label htmlFor="search-maxprice">Max Price ($)</label>
          <input
            id="search-maxprice"
            name="maxPrice"
            type="number"
            min="0"
            step="10"
            placeholder="Max $"
            disabled={isLoading}
            value={formData.maxPrice}
            onChange={handleChange}
            className={formErrors.maxPrice ? 'input-error' : ''}
            aria-invalid={!!formErrors.maxPrice}
            aria-describedby={formErrors.maxPrice ? 'maxprice-error' : undefined}
          />
          {formErrors.maxPrice && (
            <span id="maxprice-error" className="field-error-message">
              {formErrors.maxPrice}
            </span>
          )}
        </div>
      </div>

      <div className="search-form-actions">
        <button
          type="submit"
          className="btn-primary search-submit-btn"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <span className="btn-loading-content">
              <span className="spinner-small" aria-hidden="true"></span>
              <span>Scanning Sanctuaries...</span>
            </span>
          ) : (
            ' Search Sanctuaries →'
          )}
        </button>
      </div>
    </form>
  );
};

export default RoomSearchForm;
