import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCourseModulesApi, createModuleApi } from '../../services/module.service';

export default function CourseModules() {
  const { courseId } = useParams();
  const [modules, setModules] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sequenceNo, setSequenceNo] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchModules = async () => {
    try {
      const data = await getCourseModulesApi(courseId);
      setModules(data.modules || []);
      if (data.modules?.length > 0) {
        setSequenceNo(data.modules.length + 1);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch modules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, [courseId]);

  const handleAddModule = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await createModuleApi(courseId, { title, description, sequenceNo: Number(sequenceNo) });
      setTitle('');
      setDescription('');
      await fetchModules();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create module');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading course modules...</div>;

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6">
      <Link to="/instructor/courses" className="text-indigo-600 hover:underline mb-4 inline-block">
        &larr; Back to My Courses
      </Link>
      <h1 className="text-2xl font-bold mb-6">Manage Course Curriculum</h1>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

      <form onSubmit={handleAddModule} className="bg-white p-6 rounded-lg border shadow-sm mb-8 space-y-4">
        <h2 className="text-lg font-semibold border-b pb-2">Add New Module</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium mb-1">Module Title</label>
            <input
              type="text"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Introduction to Binary Trees"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Sequence No.</label>
            <input
              type="number"
              min="1"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              value={sequenceNo}
              onChange={(e) => setSequenceNo(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            rows="2"
            className="w-full border rounded px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Overview of this module's topics..."
          />
        </div>
        <button
          type="submit"
          className="bg-indigo-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-indigo-700"
        >
          + Add Module
        </button>
      </form>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Course Modules ({modules.length})</h2>
        {modules.length === 0 ? (
          <p className="text-gray-500 italic border p-4 rounded text-center">No modules created yet.</p>
        ) : (
          modules.map((m) => (
            <div key={m.module_id} className="bg-white border rounded-lg p-4 shadow-sm flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded mr-2">
                  Module #{m.sequence_no}
                </span>
                <h3 className="text-md font-bold inline-block">{m.title}</h3>
                <p className="text-sm text-gray-600 mt-1">{m.description || 'No description provided.'}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}