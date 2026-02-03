import mongoose from 'mongoose';

const venueSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  region: { type: String, default: '' },
  address: { type: String, default: '' },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  openHours: { type: String, default: '' },
  website: { type: String, default: '' },
  instagramHandle: { type: String, default: '' },
  notes: { type: String, default: '' },
  barrierFree: {
    wheelchair: { type: Boolean, default: false },
    elevator: { type: Boolean, default: false },
    braille: { type: Boolean, default: false },
    audioGuide: { type: Boolean, default: false },
    accessibleToilet: { type: Boolean, default: false },
    parkingFree: { type: Boolean, default: false },
    parkingPaid: { type: Boolean, default: false },
    guideDog: { type: Boolean, default: false },
    wheelchairGrade: { type: String, default: null },
    elevatorGrade: { type: String, default: null },
    brailleGrade: { type: String, default: null }
  },
  status: {
    hasCurrentExhibition: { type: Boolean, default: false },
    updatedAt: { type: Date, default: null }
  },
  stats: {
    averageRating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 }
  },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Venue', venueSchema);
