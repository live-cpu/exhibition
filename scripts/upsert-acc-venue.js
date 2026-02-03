import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from '../server/models/Venue.js';

dotenv.config();

async function upsertACCVenue() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    const accVenue = {
      name: '\uAD6D\uB9BD\uC544\uC2DC\uC544\uBB38\uD654\uC804\uB2F9(ACC)',
      region: '\uD638\uB0A8',
      address: '',
      location: { lat: 35.147, lng: 126.92 },
      openHours: '10:00~18:00 (\uC218,\uD1A0 ~20:00)',
      notes: '\uAD6D\uB9BD',
      barrierFree: {
        elevator: true,
        wheelchair: true,
        braille: true,
        elevatorGrade: 'O',
        wheelchairGrade: 'O',
        brailleGrade: 'O'
      },
      updatedAt: new Date()
    };

    await Venue.findOneAndUpdate(
      { name: accVenue.name },
      { $set: accVenue },
      { upsert: true, new: true }
    );

    console.log('ACC venue upserted');
  } catch (error) {
    console.error('ACC upsert failed:', error);
    process.exit(1);
  } finally {
    mongoose.connection.close();
  }
}

upsertACCVenue();
