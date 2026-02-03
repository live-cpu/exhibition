import mongoose from 'mongoose';

const privateCandidateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  titleKey: { type: String, required: true, index: true },
  venueName: { type: String, required: true, index: true },
  sources: [String],
  sourceCounts: {
    shop: { type: Number, default: 0 },
    blog: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  evidence: [
    {
      source: String,
      website: String,
      period: Object,
      price: Object,
      description: String,
      capturedAt: { type: Date, default: Date.now }
    }
  ],
  lastSeen: { type: Date, default: Date.now }
}, { strict: false });

privateCandidateSchema.index({ titleKey: 1, venueName: 1 }, { unique: true });

export default mongoose.model('PrivateCandidate', privateCandidateSchema);