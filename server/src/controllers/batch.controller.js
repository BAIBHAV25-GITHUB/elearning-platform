import { createBatchInDb, getBatchesByCourseFromDb } from '../repositories/batch.repository.js';

export const createBatch = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { batchName, startDate, endDate, maxCapacity } = req.body;

    if (!batchName || !startDate || !endDate || maxCapacity === undefined) {
      return res.status(400).json({ message: 'All batch parameters are required' });
    }

    const parsedCapacity = parseInt(maxCapacity, 10);
    if (isNaN(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 30) {
      return res.status(400).json({ message: 'maxCapacity must be an integer BETWEEN 1 AND 30' });
    }

    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({ message: 'startDate must be earlier than endDate' });
    }

    const batch = await createBatchInDb({
      courseId,
      batchName,
      startDate,
      endDate,
      maxCapacity: parsedCapacity
    });

    return res.status(201).json({
      success: true,
      message: 'Batch created successfully',
      batch
    });
  } catch (error) {
    console.error('Error creating batch:', error);
    return res.status(500).json({ message: error.message || 'Internal Server Error' });
  }
};

export const getBatchesByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const batches = await getBatchesByCourseFromDb(courseId);
    return res.status(200).json({ success: true, batches });
  } catch (error) {
    console.error('Error fetching batches:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};