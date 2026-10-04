import api from '../api/axios';

export const createCourseApi = async (courseData) => {
  const response = await api.post('/v1/courses', courseData);
  return response.data;
};

export const getInstructorCoursesApi = async () => {
  const response = await api.get('/v1/courses/instructor');
  return response.data;
};

