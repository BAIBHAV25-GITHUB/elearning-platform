# Quick API smoke test against a running server + seeded DB.  Usage: API=localhost:5000/api/v1 bash scripts/smoke-test.sh
# Needs `node` and `curl`. Creates a few throw-away users/courses (t1@x.com, t2@x.com, "Smoke").
A=${API:-localhost:5000/api/v1}
j(){ curl -s -w ' [%{http_code}]' -H 'Content-Type: application/json' "$@"; echo; }
tok(){ node -e "console.log(JSON.parse(process.argv[1]).token||'')" "$1"; }
echo "1 register student:"; R=$(curl -s -H 'Content-Type: application/json' -d '{"name":"Test S","email":"t1@x.com","password":"Password123!"}' $A/auth/register); echo $R | cut -c1-120; ST=$(tok "$R")
echo "2 /auth/me:"; j -H "Authorization: Bearer $ST" $A/auth/me
echo "3 register admin (expect 400):"; j -d '{"name":"Evil","email":"e@x.com","password":"Password123!","role":"admin"}' $A/auth/register
echo "4 login seed instructor:"; R=$(curl -s -H 'Content-Type: application/json' -d '{"email":"john.doe@elearning.com","password":"Password123!"}' $A/auth/login); echo $R | cut -c1-140; IT=$(tok "$R")
echo "5 catalog (guest):"; j $A/courses | cut -c1-200
echo "6 course 4 draft as guest (expect 404):"; j $A/courses/4
echo "7 course 1 details guest (modules, no urls):"; curl -s $A/courses/1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).course;console.log(c.title,c.modules.length,'modules; url leak:',c.modules.flatMap(m=>m.contents).some(x=>x.video_url))})"
echo "8 batches guest:"; j $A/courses/1/batches | cut -c1-300
echo "9 student creates course (403):"; j -H "Authorization: Bearer $ST" -d '{"courseName":"x","price":1}' $A/courses
echo "10 instructor creates+publishes course:"; R=$(curl -s -H "Authorization: Bearer $IT" -H 'Content-Type: application/json' -d '{"courseName":"Smoke","price":0}' $A/courses); echo $R | cut -c1-100; CID=$(node -e "console.log(JSON.parse(process.argv[1]).course.course_id)" "$R")
j -X PATCH -H "Authorization: Bearer $IT" $A/courses/$CID/publish | cut -c1-120
echo "11 other instructor can't touch (sarah):"; R=$(curl -s -H 'Content-Type: application/json' -d '{"email":"sarah.smith@elearning.com","password":"Password123!"}' $A/auth/login); ST2=$(tok "$R"); j -H "Authorization: Bearer $ST2" -d '{"title":"m"}' $A/courses/$CID/modules
echo "12 instructor creates batch cap 1:"; j -H "Authorization: Bearer $IT" -d '{"batchName":"B","startDate":"2027-01-01","endDate":"2027-02-01","maxCapacity":1}' $A/courses/$CID/batches | cut -c1-200
BID=$(curl -s $A/courses/$CID/batches | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).batches[0].batch_id))")
echo "13 student enrolls free course:"; j -H "Authorization: Bearer $ST" -d "{\"courseId\":$CID,\"batchId\":$BID}" $A/enrollments
echo "14 2nd student -> 409 capacity:"; R=$(curl -s -H 'Content-Type: application/json' -d '{"name":"S2","email":"t2@x.com","password":"Password123!"}' $A/auth/register); T2=$(tok "$R"); j -H "Authorization: Bearer $T2" -d "{\"courseId\":$CID,\"batchId\":$BID}" $A/enrollments
echo "15 IDOR: S2 reads S1 progress (404):"; j -H "Authorization: Bearer $T2" $A/progress/1
echo "16 student analytics (403):"; j -H "Authorization: Bearer $ST" $A/analytics/overview
echo "17 instructor analytics:"; j -H "Authorization: Bearer $IT" $A/analytics/overview | cut -c1-200
echo "18 student announcement (403):"; j -H "Authorization: Bearer $ST" -d '{"title":"a","content":"b"}' $A/courses/$CID/announcements
echo "19 my enrollments:"; j -H "Authorization: Bearer $ST" $A/enrollments/me | cut -c1-250
echo "20 drop then S2 enrolls:"; EID=$(curl -s -H "Authorization: Bearer $ST" $A/enrollments/me | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).enrollments[0].enrollment_id))"); j -X POST -H "Authorization: Bearer $ST" $A/enrollments/$EID/drop; j -H "Authorization: Bearer $T2" -d "{\"courseId\":$CID,\"batchId\":$BID}" $A/enrollments; j -H "Authorization: Bearer $ST" -d "{\"courseId\":$CID,\"batchId\":$BID}" $A/enrollments
echo "21 webhook no sig (503/400):"; j -d '{}' $A/payments/webhook
echo "22 bad token (401):"; j -H "Authorization: Bearer junk" $A/auth/me
echo "23 notifications/progress/certs:"; j -H "Authorization: Bearer $T2" $A/notifications | cut -c1-200; j -H "Authorization: Bearer $T2" $A/certificates/my-certificates | cut -c1-200
