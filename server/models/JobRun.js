import mongoose from 'mongoose';

const jobRunSchema = new mongoose.Schema({
  job: { type: String, required: true },
  dateKey: { type: String, required: true },
  lastRunAt: { type: Date, default: null },
  runs: { type: Number, default: 0 },
  meta: { type: Object, default: {} }
}, {
  timestamps: true
});

jobRunSchema.index({ job: 1, dateKey: 1 }, { unique: true });

export default mongoose.model('JobRun', jobRunSchema);
