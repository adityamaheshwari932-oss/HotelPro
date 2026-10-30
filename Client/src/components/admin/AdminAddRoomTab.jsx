import React, { useState, useEffect } from 'react';
import { getHotels, createRoom } from '../../api/roomApi';

const DEFAULT_AMENITY_OPTIONS = [
  'High-speed Fiber WiFi',
  'Ergonomic Workstation',
  'Italian Marble Bath',
  'Smart Climate Control',
  'Private Terrace',
  'Bespoke Espresso Bar',
  'Acoustic Sound Insulation',
  'California King Bed',
  'Spatial Audio System'
];

export const AdminAddRoomTab = ({ onRoomCreated }) => {
  const [hotels, setHotels] = useState([]);
  const [hotelsLoading, setHotelsLoading] = useState(true);
  const [hotelsError, setHotelsError] = useState(null);

  const [formData, setFormData] = useState({
    hotel: '',
    roomNumber: '',
    roomType: 'single',
    capacity: 1,
    basePrice: 150,
    description: '',
    status: 'active',
    photos: ''
  });

  const [selectedAmenities, setSelectedAmenities] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [createdRoomInfo, setCreatedRoomInfo] = useState(null);

  // Load available hotels on mount
  useEffect(() => {
    let isMounted = true;
    const fetchHotels = async () => {
      try {
        setHotelsLoading(true);
        setHotelsError(null);
        const res = await getHotels();
        const hotelList = res.data?.hotels || [];
        if (isMounted) {
          setHotels(hotelList);
          // If only 1 hotel exists, auto-select it
          if (hotelList.length === 1) {
            setFormData((prev) => ({ ...prev, hotel: hotelList[0]._id }));
          }
        }
      } catch (err) {
        if (isMounted) {
          setHotelsError(err.message || 'Failed to load hotels. Please try again.');
        }
      } finally {
        if (isMounted) setHotelsLoading(false);
      }
    };

    fetchHotels();
    return () => {
      isMounted = false;
    };
  }, []);

  const toggleAmenity = (amenity) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity]
    );
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.hotel) {
      errors.hotel = 'Please select a hotel property.';
    }

    if (!formData.roomNumber.trim()) {
      errors.roomNumber = 'Room number is required (e.g. 101, 204).';
    }

    const cap = parseInt(formData.capacity, 10);
    if (isNaN(cap) || cap < 1) {
      errors.capacity = 'Capacity must be at least 1 guest.';
    }

    const price = parseFloat(formData.basePrice);
    if (isNaN(price) || price < 0) {
      errors.basePrice = 'Base price must be a non-negative number.';
    }

    if (!['single', 'double', 'suite'].includes(formData.roomType)) {
      errors.roomType = 'Room type must be single, double, or suite.';
    }

    // Validate photo URLs if entered
    if (formData.photos.trim()) {
      const urls = formData.photos
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) {
          errors.photos = `Invalid photo URL: "${url}". URLs must begin with http:// or https://.`;
          break;
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError(null);
    setCreatedRoomInfo(null);

    if (!validateForm()) {
      return;
    }

    try {
      setIsSubmitting(true);

      // Clean photo URLs
      const photoUrls = formData.photos
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      // Assemble final description: integrate amenities cleanly into description
      let finalDescription = formData.description.trim();
      if (selectedAmenities.length > 0) {
        const amenitiesText = `Amenities: ${selectedAmenities.join(', ')}`;
        finalDescription = finalDescription
          ? `${finalDescription}\n\n${amenitiesText}`
          : amenitiesText;
      }

      const payload = {
        hotel: formData.hotel,
        roomNumber: formData.roomNumber.trim(),
        roomType: formData.roomType,
        capacity: parseInt(formData.capacity, 10),
        basePrice: parseFloat(formData.basePrice),
        description: finalDescription,
        photos: photoUrls,
        status: formData.status
      };

      const res = await createRoom(payload);
      const created = res.data?.room;

      setCreatedRoomInfo(created || payload);

      // Reset form fields
      setFormData({
        hotel: hotels.length === 1 ? hotels[0]._id : '',
        roomNumber: '',
        roomType: 'single',
        capacity: 1,
        basePrice: 150,
        description: '',
        status: 'active',
        photos: ''
      });
      setSelectedAmenities([]);
      setFieldErrors({});

      if (onRoomCreated) {
        onRoomCreated(created);
      }
    } catch (err) {
      setApiError(err.message || 'Failed to create room. Please review the form and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-tab-content" data-testid="admin-add-room-tab">
      <div className="admin-section-header">
        <div>
          <h3>Add New Room</h3>
          <p className="admin-section-desc">
            Register a new sanctuary into HotelPro's dynamic inventory. All fields are verified against backend schema constraints.
          </p>
        </div>
      </div>

      {createdRoomInfo && (
        <div className="alert alert-success" role="alert" data-testid="add-room-success-banner">
          <div className="alert-content">
            <strong>Room #{createdRoomInfo.roomNumber} Created Successfully!</strong>
            <p className="mb-0">
              The room has been added to the inventory as a {createdRoomInfo.roomType} room with status: {createdRoomInfo.status}.
            </p>
          </div>
        </div>
      )}

      {apiError && (
        <div className="alert alert-error" role="alert" data-testid="add-room-api-error">
          <p>{apiError}</p>
        </div>
      )}

      {hotelsError && (
        <div className="alert alert-error" role="alert">
          <p>{hotelsError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="admin-form-card" data-testid="add-room-form">
        {/* Hotel & Room Number */}
        <div className="form-grid-2">
          <div className="form-group">
            <label htmlFor="addRoomHotel" className="form-label">
              Hotel Property: <span className="text-danger">*</span>
            </label>
            <select
              id="addRoomHotel"
              value={formData.hotel}
              onChange={(e) => {
                setFormData({ ...formData, hotel: e.target.value });
                if (fieldErrors.hotel) setFieldErrors({ ...fieldErrors, hotel: null });
              }}
              className={`form-input form-select ${fieldErrors.hotel ? 'input-error' : ''}`}
              disabled={hotelsLoading || isSubmitting}
              data-testid="add-room-hotel-select"
            >
              <option value="">{hotelsLoading ? 'Loading hotels...' : '-- Select Hotel Property --'}</option>
              {hotels.map((h) => (
                <option key={h._id} value={h._id}>
                  {h.name} ({h.address?.city || 'Cupertino'}, {h.address?.state || 'CA'})
                </option>
              ))}
            </select>
            {fieldErrors.hotel && <span className="field-error-text" role="alert">{fieldErrors.hotel}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="addRoomNumber" className="form-label">
              Room Number: <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              id="addRoomNumber"
              placeholder="e.g. 101, 204, PH1"
              value={formData.roomNumber}
              onChange={(e) => {
                setFormData({ ...formData, roomNumber: e.target.value });
                if (fieldErrors.roomNumber) setFieldErrors({ ...fieldErrors, roomNumber: null });
              }}
              className={`form-input ${fieldErrors.roomNumber ? 'input-error' : ''}`}
              disabled={isSubmitting}
              data-testid="add-room-number-input"
            />
            {fieldErrors.roomNumber && <span className="field-error-text" role="alert">{fieldErrors.roomNumber}</span>}
          </div>
        </div>

        {/* Room Type, Capacity, Base Price, Status */}
        <div className="form-grid-2">
          <div className="form-group">
            <label htmlFor="addRoomType" className="form-label">
              Room Type: <span className="text-danger">*</span>
            </label>
            <select
              id="addRoomType"
              value={formData.roomType}
              onChange={(e) => setFormData({ ...formData, roomType: e.target.value })}
              className="form-input form-select"
              disabled={isSubmitting}
              data-testid="add-room-type-select"
            >
              <option value="single">Single Sanctuary (1 bed)</option>
              <option value="double">Double Sanctuary (2 beds)</option>
              <option value="suite">Luxury Suite (Living room + Master suite)</option>
            </select>
            {fieldErrors.roomType && <span className="field-error-text" role="alert">{fieldErrors.roomType}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="addRoomCapacity" className="form-label">
              Max Guest Capacity: <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              id="addRoomCapacity"
              min="1"
              max="10"
              value={formData.capacity}
              onChange={(e) => {
                setFormData({ ...formData, capacity: e.target.value });
                if (fieldErrors.capacity) setFieldErrors({ ...fieldErrors, capacity: null });
              }}
              className={`form-input ${fieldErrors.capacity ? 'input-error' : ''}`}
              disabled={isSubmitting}
              data-testid="add-room-capacity-input"
            />
            {fieldErrors.capacity && <span className="field-error-text" role="alert">{fieldErrors.capacity}</span>}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label htmlFor="addRoomBasePrice" className="form-label">
              Base Nightly Rate ($ USD): <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              id="addRoomBasePrice"
              min="0"
              step="1"
              placeholder="e.g. 250"
              value={formData.basePrice}
              onChange={(e) => {
                setFormData({ ...formData, basePrice: e.target.value });
                if (fieldErrors.basePrice) setFieldErrors({ ...fieldErrors, basePrice: null });
              }}
              className={`form-input ${fieldErrors.basePrice ? 'input-error' : ''}`}
              disabled={isSubmitting}
              data-testid="add-room-price-input"
            />
            {fieldErrors.basePrice && <span className="field-error-text" role="alert">{fieldErrors.basePrice}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="addRoomStatus" className="form-label">
              Operational Status: <span className="text-danger">*</span>
            </label>
            <select
              id="addRoomStatus"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="form-input form-select"
              disabled={isSubmitting}
              data-testid="add-room-status-select"
            >
              <option value="active">Active (Instantly bookable by guests)</option>
              <option value="maintenance">Maintenance (Offline for preparations)</option>
              <option value="inactive">Inactive (Hidden from booking engine)</option>
            </select>
          </div>
        </div>

        {/* Amenities Selection Chips */}
        <div className="form-group">
          <label className="form-label">
            Featured Amenities &amp; Characteristics:
          </label>
          <div className="amenities-selection-grid" role="group" aria-label="Room amenities selection">
            {DEFAULT_AMENITY_OPTIONS.map((amenity) => {
              const isChecked = selectedAmenities.includes(amenity);
              return (
                <button
                  type="button"
                  key={amenity}
                  className={`amenity-chip-btn ${isChecked ? 'selected' : ''}`}
                  onClick={() => toggleAmenity(amenity)}
                  aria-pressed={isChecked}
                  disabled={isSubmitting}
                >
                  <span className="amenity-check-icon">{isChecked ? '✓' : '+'}</span>
                  <span>{amenity}</span>
                </button>
              );
            })}
          </div>
          <small className="form-help-text">
            Selected amenities are automatically appended to the room description.
          </small>
        </div>

        {/* Description Textarea */}
        <div className="form-group">
          <label htmlFor="addRoomDescription" className="form-label">
            Description / Overview:
          </label>
          <textarea
            id="addRoomDescription"
            rows="3"
            placeholder="Describe the aesthetic, lighting, layout, views, and unique atmosphere of this room..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="form-input form-textarea"
            disabled={isSubmitting}
            data-testid="add-room-desc-input"
          />
        </div>

        {/* Photo URLs Textarea */}
        <div className="form-group">
          <label htmlFor="addRoomPhotos" className="form-label">
            Image URLs (one URL per line):
          </label>
          <textarea
            id="addRoomPhotos"
            rows="3"
            placeholder="https://images.unsplash.com/photo-1590490360182-c33d57733427&#10;https://images.unsplash.com/photo-1566665797739-1674de7a421a"
            value={formData.photos}
            onChange={(e) => {
              setFormData({ ...formData, photos: e.target.value });
              if (fieldErrors.photos) setFieldErrors({ ...fieldErrors, photos: null });
            }}
            className={`form-input form-textarea ${fieldErrors.photos ? 'input-error' : ''}`}
            disabled={isSubmitting}
            data-testid="add-room-photos-input"
          />
          {fieldErrors.photos && <span className="field-error-text" role="alert">{fieldErrors.photos}</span>}
          <small className="form-help-text">
            Provide valid HTTPS links to photography showcasing this sanctuary.
          </small>
        </div>

        {/* Form Action Controls */}
        <div className="form-actions-bar">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || hotelsLoading}
            data-testid="btn-submit-add-room"
          >
            {isSubmitting ? 'Creating Room...' : '+ Create Sanctuary Room'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminAddRoomTab;
