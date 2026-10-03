import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function CourseDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/courses/${id}`)
      .then((res) => {
        setCourse(res.data.course);
        if (res.data.course.lessons?.length > 0) {
          setActiveLesson(res.data.course.lessons[0]);
        }
      })
      .finally(() => setLoading(false));
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
    const isLoaded = await loadRazorpayScript();
    if (!isLoaded) {
      alert('Razorpay SDK failed to load');
      return;
    }

    try {
      const orderRes = await api.post('/payments/create-order', { courseId: course.id });
      const { order, key_id } = orderRes.data;

      const options = {
        key: key_id,
        amount: order.amount,
        currency: order.currency,
        name: course.title,
        description: 'Course Enrollment Fee',
        order_id: order.id,
        handler: async (response) => {
          await api.post('/payments/verify', {
            courseId: course.id,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          alert('Enrollment Successful!');
          window.location.reload();
        },
        prefill: {
          name: user?.name,
          email: user?.email,
        },
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();
    } catch (err) {
      alert(err.response?.data?.message || 'Checkout failed');
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
            <img src={course.thumbnail_url} alt={course.title} className="w-full h-96 object-cover rounded-xl" />
          )}
          <h1 className="text-3xl font-bold mt-6 text-slate-800">{course.title}</h1>
          <p className="text-slate-600 mt-4 leading-relaxed">{course.description}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-100 h-fit">
          <div className="text-3xl font-bold text-indigo-600 mb-4">₹{course.price}</div>
          <button
            onClick={handleEnroll}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg mb-6 transition"
          >
            Enroll Now
          </button>
          <h3 className="text-lg font-bold text-slate-800 mb-3">Course Content</h3>
          <div className="space-y-2">
            {course.lessons?.map((lesson, idx) => (
              <div
                key={lesson.id}
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
  );
}