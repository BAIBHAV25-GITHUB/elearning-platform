import * as moduleRepo from '../repositories/module.repository.js';

export const createModule = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, description, sequenceNo } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Module title is required' });
    }

    if (sequenceNo === undefined || Number(sequenceNo) < 1) {
      return res.status(400).json({ message: 'Sequence number must be a positive integer' });
    }

    const module = await moduleRepo.createModuleInDb({
      courseId,
      title,
      description,
      sequenceNo: Number(sequenceNo),
    });

    return res.status(201).json({ success: true, module });
  } catch (err) {
    // Unique constraint violation in PostgreSQL (UNIQUE(course_id, sequence_no))
    if (err.code === '23505') {
      return res.status(409).json({ 
        message: `Sequence number ${req.body.sequenceNo} is already assigned to another module in this course.` 
      });
    }
    return res.status(500).json({ message: err.message || 'Error creating module' });
  }
};

export const getCourseModules = async (req, res) => {
  try {
    const { courseId } = req.params;
    const modules = await moduleRepo.findModulesByCourseId(courseId);
    return res.status(200).json({ success: true, modules });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Error fetching modules' });
  }
};