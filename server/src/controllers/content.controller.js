import { uploadStreamToCloudinary } from '../integrations/cloudinary.js';
import * as contentRepo from '../repositories/content.repository.js';

export const addContentToModule = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { title, type, sequenceNo } = req.body;

    if (!title || !sequenceNo) {
      return res.status(400).json({ message: 'Title and sequenceNo are required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Media file is required' });
    }

    // 1. Upload file buffer to Cloudinary
    const cloudinaryResult = await uploadStreamToCloudinary(req.file.buffer, {
      resource_type: type === 'video' ? 'video' : 'raw',
    });

    // 2. Extract video details
    const videoUrl = cloudinaryResult.secure_url;
    const cloudinaryId = cloudinaryResult.public_id;
    const durationSec = Math.round(cloudinaryResult.duration || 0);

    // 3. Save content row into Database
    const newContent = await contentRepo.createContent({
      moduleId,
      title,
      type: type || 'video',
      videoUrl,
      cloudinaryId,
      durationSec,
      sequenceNo: parseInt(sequenceNo, 10),
    });

    return res.status(201).json({
      success: true,
      message: 'Content uploaded and added successfully',
      content: newContent,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Content creation failed' });
  }
};