import api from '../api/axios';

export const createCourseApi = async (courseData) => {
  const response = await api.post('/courses', courseData);
  return response.data;
};

export const getInstructorCoursesApi = async () => {
  const response = await api.get('/courses/instructor/me');
  return response.data;
};


export const publishCourseApi = async (courseId) => {
  const response = await api.patch(`/courses/${courseId}/publish`);
  return response.data;
};

export const getManagedCourseApi = async (courseId) => {
  const response = await api.get(`/courses/${courseId}/manage`);
  return response.data;
};

export const updateCourseApi = async (courseId, patch) => {
  const response = await api.patch(`/courses/${courseId}`, patch);
  return response.data;
};

/** status: 'draft' (unpublish) | 'published' | 'archived' */
export const setCourseStatusApi = async (courseId, status) => {
  const response = await api.patch(`/courses/${courseId}/status`, { status });
  return response.data;
};

export const deleteCourseApi = async (courseId) => {
  const response = await api.delete(`/courses/${courseId}`);
  return response.data;
};

export const getCourseBatchesApi = async (courseId) => {
  const response = await api.get(`/courses/${courseId}/batches`);
  return response.data;
};

/** patch: { batchName, startDate, endDate, maxCapacity, status: 'open' | 'closed' } */
export const updateBatchApi = async (courseId, batchId, patch) => {
  const response = await api.patch(`/courses/${courseId}/batches/${batchId}`, patch);
  return response.data;
};
