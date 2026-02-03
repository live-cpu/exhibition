import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  exhibitionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Exhibition',
    required: true 
  },
  userId: String,
  userName: { type: String, default: '익명' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  images: [String],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Review', reviewSchema);