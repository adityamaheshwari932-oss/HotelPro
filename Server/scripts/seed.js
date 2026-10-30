require('dotenv').config();
const mongoose = require('mongoose');
const { Hotel, Room } = require('../src/models');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hotelpro';
  console.log(`Connecting to ${uri}...`);
  await mongoose.connect(uri);

  let hotel = await Hotel.findOne({ name: 'HotelPro Sanctuary Cupertino' });
  if (!hotel) {
    hotel = await Hotel.create({
      name: 'HotelPro Sanctuary Cupertino',
      description: 'An architectural marvel of ultra-luxury hospitality, modern glass architecture, and seamless technology.',
      address: {
        street: '1 Infinite Loop, Suite 100',
        city: 'Cupertino',
        state: 'CA',
        country: 'USA',
        postalCode: '95014'
      },
      contact: {
        phone: '+1 (408) 996-1010',
        email: 'concierge@hotelpro.apple.com'
      },
      status: 'active'
    });
    console.log(`Created hotel: ${hotel.name} (${hotel._id})`);
  } else {
    console.log(`Found existing hotel: ${hotel.name}`);
  }

  const roomData = [
    {
      roomNumber: '101',
      roomType: 'single',
      capacity: 1,
      basePrice: 180,
      description: 'A serene minimalist enclave designed with natural white oak, acoustic insulation, an ultra-crisp work sanctuary, and a plush queen bed.',
      photos: [
        'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    },
    {
      roomNumber: '102',
      roomType: 'single',
      capacity: 1,
      basePrice: 195,
      description: 'Curated for the modern creator. Ergonomic seating, whisper-quiet acoustic baffles, high-speed fiber uplink, and bespoke pour-over espresso bar.',
      photos: [
        'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    },
    {
      roomNumber: '201',
      roomType: 'double',
      capacity: 2,
      basePrice: 320,
      description: 'Floor-to-ceiling glass offering panoramic skyline views. Features a California King bed, custom ambient lighting, automated drapery, and private terrace.',
      photos: [
        'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    },
    {
      roomNumber: '301',
      roomType: 'double',
      capacity: 2,
      basePrice: 380,
      description: 'Nestled within a private botanical grove. Features indoor-outdoor rain shower, organic Japanese soaking tub, and custom smart climate control.',
      photos: [
        'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    },
    {
      roomNumber: '401',
      roomType: 'suite',
      capacity: 4,
      basePrice: 550,
      description: 'Architectural grandeur across 1,400 sq.ft. Includes two master chambers, bespoke Italian marble bath, private chef kitchenette, and spatial audio lounge.',
      photos: [
        'https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    },
    {
      roomNumber: '501',
      roomType: 'suite',
      capacity: 4,
      basePrice: 890,
      description: 'The pinnacle of modern luxury hospitality. Private rooftop infinity plunge pool, 360-degree sunset vista, dedicated personal concierge, and private elevator entry.',
      photos: [
        'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=85',
        'https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=1200&q=85'
      ],
      status: 'active'
    }
  ];

  for (const item of roomData) {
    const existing = await Room.findOne({ hotel: hotel._id, roomNumber: item.roomNumber });
    if (!existing) {
      await Room.create({
        hotel: hotel._id,
        ...item
      });
      console.log(`Seeded Room ${item.roomNumber} (${item.roomType})`);
    } else {
      console.log(`Room ${item.roomNumber} already exists`);
    }
  }

  console.log('Seeding complete!');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
