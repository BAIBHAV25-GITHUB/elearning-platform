import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCourseApi } from '../../services/course.service';

export default function CreateCourse() {
  const [courseName, setCourseName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await createCourseApi({ courseName, description, price: Number(price) });
      navigate('/instructor/courses');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create course');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded-xl shadow border">
      <h1 className="text-2xl font-bold mb-6">Create New Course</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Course Title</label>
          <input
            type="text"
            required
            className="w-full border rounded px-3 py-2"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="e.g. Master Data Structures in C++"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            rows="4"
            className="w-full border rounded px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Comprehensive guide to algorithms..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Price (USD / INR)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            required
            className="w-full border rounded px-3 py-2"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>

        <div className="flex gap-4 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 text-white px-6 py-2 rounded font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Course'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/instructor/courses')}
            className="bg-gray-100 text-gray-700 px-6 py-2 rounded font-semibold hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}