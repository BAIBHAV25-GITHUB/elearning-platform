import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getManagedCourseApi, updateCourseApi } from '../../services/course.service';

export default function EditCourse() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState({ status: '', enrollmentCount: 0 });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { course } = await getManagedCourseApi(courseId);
        setForm({
          title: course.title ?? '',
          description: course.description ?? '',
          price: course.price ?? 0,
          thumbnailUrl: course.thumbnail_url ?? '',
        });
        setMeta({ status: course.status, enrollmentCount: course.enrollment_count ?? 0 });
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load the course');
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId]);

  const set = (key) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const priceLocked = meta.enrollmentCount > 0;
  const archived = meta.status === 'archived';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const patch = {
        title: form.title,
        description: form.description,
        thumbnailUrl: form.thumbnailUrl.trim() || null,
      };
      if (!priceLocked) patch.price = Number(form.price);
      await updateCourseApi(courseId, patch);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save the course');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading course...</div>;
  if (!form) {
    return <div className="max-w-2xl mx-auto mt-10 p-6 bg-red-50 text-red-600 rounded">{error || 'Course not found'}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto mt-10 p-6 bg-white rounded-xl shadow border">
      <h1 className="text-2xl font-bold mb-1">Edit Course</h1>
      <p className="text-sm text-gray-500 mb-6 capitalize">Status: {meta.status}</p>

      {archived && (
        <div className="bg-yellow-50 text-yellow-800 p-3 rounded mb-4 text-sm">
          This course is archived and read-only. Restore it from your course list to edit it.
        </div>
      )}
      {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
      {saved && <div className="bg-emerald-50 text-emerald-700 p-3 rounded mb-4 text-sm">Changes saved.</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-1">Course Title</label>
          <input id="title" type="text" required maxLength={255} disabled={archived}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            value={form.title} onChange={set('title')} />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-1">Description</label>
          <textarea id="description" rows="4" disabled={archived}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            value={form.description} onChange={set('description')} />
        </div>

        <div>
          <label htmlFor="price" className="block text-sm font-medium mb-1">Price (INR, 0 for free)</label>
          <input id="price" type="number" min="0" step="0.01" required disabled={archived || priceLocked}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            value={form.price} onChange={set('price')} />
          {priceLocked && (
            <p className="text-xs text-gray-500 mt-1">
              The price is locked because {meta.enrollmentCount} student{meta.enrollmentCount === 1 ? ' has' : 's have'} enrolled.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="thumb" className="block text-sm font-medium mb-1">Thumbnail image URL (optional)</label>
          <input id="thumb" type="url" disabled={archived}
            className="w-full border rounded px-3 py-2 disabled:bg-gray-100"
            value={form.thumbnailUrl} onChange={set('thumbnailUrl')} placeholder="https://..." />
        </div>

        <div className="flex gap-4 pt-2">
          <button type="submit" disabled={saving || archived}
            className="bg-indigo-600 text-white px-6 py-2 rounded font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          <button type="button" onClick={() => navigate('/instructor/courses')}
            className="bg-gray-100 text-gray-700 px-6 py-2 rounded font-semibold hover:bg-gray-200">
            Back to courses
          </button>
        </div>
      </form>
    </div>
  );
}
