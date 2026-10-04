import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function CourseDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchCourseAndBatches = async () => {
      try {
        const [courseRes, batchesRes] = await Promise.all([
          api.get(`/courses/${id}`),
          api.get(`/courses/${id}/batches`)
        ]);

        const courseData = courseRes.data.course || courseRes.data;
        setCourse(courseData);
        setBatches(batchesRes.data.batches || []);

        if (courseData.lessons?.length > 0) {
          setActiveLesson(courseData.lessons[0]);
        }
      } catch (err) {
        console.error('Failed to load course details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCourseAndBatches();
  }, [id]);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleEnroll = async () => {
    if (!selectedBatchId) {
      setErrorMsg('Please select a batch before proceeding.');
      return;
    }

    setErrorMsg('');
    setEnrolling(true);

    try {
      // Step 1: Create pending enrollment transaction (Day 14)
      const enrollRes = await api.post('/enrollments', {
        courseId: parseInt(id, 10),
        batchId: parseInt(selectedBatchId, 10)
      });
      const enrollmentId = enrollRes.data.enrollmentId;

      // Step 2: Load Razorpay Checkout Script
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded) {
        setErrorMsg('Razorpay SDK failed to load');
        setEnrolling(false);
        return;
      }

      // Step 3: Create Payment Order matching enrollment (Day 16)
      const orderRes = await api.post('/payments/create-order', { enrollmentId });
      const { order, key_id } = orderRes.data;

      // Step 4: Launch Razorpay Modal
      const options = {
        key: key_id,
        amount: order.amount,
        currency: order.currency,
        name: course.title,
        description: 'Course Enrollment Fee',
        order_id: order.id,
        handler: async (response) => {
          try {
            await api.post('/payments/verify', {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            alert('Enrollment and Payment Successful!');
            navigate('/student/dashboard');
          } catch (err) {
            setErrorMsg(err.response?.data?.message || 'Payment verification failed.');
          }
        },
        prefill: {
          name: user?.name || user?.userName,
          email: user?.email,
        },
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Enrollment transaction failed');
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) return <div className="text-center py-20">Loading course details...</div>;
  if (!course) return <div className="text-center py-20">Course not found.</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        <div className="lg:col-span-2">
          {activeLesson ? (
            <div className="bg-black rounded-xl overflow-hidden aspect-video shadow-lg">
              <video src={activeLesson.video_url} controls className="w-full h-full" />
            </div>
          ) : (
            <img
              src={course.thumbnail_url || 'https://via.placeholder.com/600x350'}
              alt={course.title}
              className="w-full h-96 object-cover rounded-xl"
            />
          )}
          <h1 className="text-3xl font-bold mt-6 text-slate-800">{course.title}</h1>
          <p className="text-slate-600 mt-4 leading-relaxed">{course.description}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-100 h-fit space-y-6">
          <div className="text-3xl font-bold text-indigo-600">₹{course.price}</div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg">
              {errorMsg}
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
              Select Batch
            </h3>
            {batches.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No active batches available.</p>
            ) : (
              <div className="space-y-2">
                {batches.map((batch) => {
                  const isFull = batch.current_capacity >= batch.max_capacity;
                  return (
                    <label
                      key={batch.batch_id}
                      className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer text-sm transition ${
                        selectedBatchId === String(batch.batch_id)
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      } ${isFull ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="batch"
                          value={batch.batch_id}
                          disabled={isFull}
                          checked={selectedBatchId === String(batch.batch_id)}
                          onChange={(e) => setSelectedBatchId(e.target.value)}
                          className="accent-indigo-600"
                        />
                        <div>
                          <div className="font-semibold">{batch.batch_name}</div>
                          <div className="text-xs text-slate-500">
                            {new Date(batch.start_date).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${isFull ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {batch.current_capacity}/{batch.max_capacity} Seats
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleEnroll}
            disabled={enrolling || batches.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
          >
            {enrolling ? 'Processing...' : 'Enroll & Pay'}
          </button>

          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-3">Course Content</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {course.lessons?.map((lesson, idx) => (
                <div
                  key={lesson.id || idx}
                  onClick={() => setActiveLesson(lesson)}
                  className={`p-3 rounded-lg cursor-pointer text-sm font-medium transition ${
                    activeLesson?.id === lesson.id ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {idx + 1}. {lesson.title}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}