# CanvasMultiCurl
Node.js library that uses Bottleneck and Axios to handle concurrent calls to Canvas LMS API. Uses backoff delays if it hits 403 throttles and various calculations for efficiency.

Built in the thick of many real-world Canvas tasks. Still very much a work in progress. Not linted. No guarantees that anything will work or won't hopelessly erase all your Canvas data etc. Be adventurous; have fun; etc. Please feel free to make pull requests and improvements as needed. Big thanks to [James Jones](https://community.canvaslms.com/t5/user/viewprofilepage/user-id/105160) for his tips and tricks and help with speculative concurrency.

## Notes

1) Handles bookmarks sequentially. Speculative concurrency is hard with bookmarks on purpose because Canvas doesn't want you hogging the API, which is fair. If you want to dive in, you might start with [this Canvas Community post](https://community.canvaslms.com/t5/Canvas-Developers-Group/Submissions-API-not-returning-all-submissions/m-p/51725), where James explains that bookmarks are Base64 JSON strings, and in theory if you know how your data results are being sorted, you could do speculative concurrency with bookmarks.
2) getList if you need a list from one endpoint; getAllResultsFromArray if you need something like all the assignments in a list of courses (be careful about memory limits and all that if you're getting big objects like submissions)
3) getSubmissions is really the only "helper" function because I found myself getting submissions so often. But you could go to town with other levels of abstraction if you want!
4) Why axios and not fetch? I like axios better. Change it to fetch if you want; life is short; go see the Grand Canyon; etc.

## Usage Examples

### 1. **`getList()`** - Fetching a List of Items from the API
The `getList` function allows you to fetch paginated lists of items from Canvas, such as courses, assignments, or students.

#### Example: Fetch all courses
```j
const CanvasMultiCurl = require('./CanvasMultiCurl');
const canvas = new CanvasMultiCurl('YOUR_CANVAS_ACCESS_TOKEN', 'https://canvas.your-instance.com');

// Fetch all the courses, 100 at a time
(async () => {
  try {
    const courses = await canvas.getList('courses');
    console.log('Courses:', courses);
  } catch (error) {
    console.error('Error fetching courses:', error);
  }
})();
```

#### Example: Fetch all assignments for a specific course
```j
const courseId = 12345; // Replace with your course ID
(async () => {
  try {
    const assignments = await canvas.getList(`courses/${courseId}/assignments`);
    console.log('Assignments:', assignments);
  } catch (error) {
    console.error('Error fetching assignments:', error);
  }
})();
```

### Example: Fetch assignments in a course filtered by `bucket` and `search_term` parameters
```j
const courseId = 12345; // Replace with your course ID

(async () => {
  try {
    // Use vars to filter assignments by a specific bucket and search term
    const vars = `bucket=past&search_term=project`; // Example: Fetch 'past' assignments that include the word 'project'

    const assignments = await canvas.getList(`courses/${courseId}/assignments`, vars);
    console.log('Filtered assignments:', assignments);
  } catch (error) {
    console.error('Error fetching filtered assignments:', error);
  }
})();
```

---

### 2. **`request()`** - Making API Requests
The `request` function is a flexible way to make any kind of API request (GET, POST, PUT, DELETE). You can use it for actions such as updating, creating, or deleting items in Canvas.

#### Example: Updating an Assignment
```j
const courseId = 12345;
const assignmentId = 67890;
const updatedData = {
  assignment: {
    name: "Updated Assignment Name",
    description: "This is the updated assignment description."
  }
};

(async () => {
  try {
    const response = await canvas.request(`courses/${courseId}/assignments/${assignmentId}`, 'PUT', updatedData, 'assignment');
    console.log('Assignment updated:', response);
  } catch (error) {
    console.error('Error updating assignment:', error);
  }
})();
```

---

### 3. **`getAllResultsFromArray()`** - Fetching Multiple Items in Parallel
The `getAllResultsFromArray` method allows you to make multiple requests in parallel, which is useful for fetching large datasets more efficiently.

#### Example: Fetch assignments for multiple courses
```j
const courseIds = [12345, 67890, 11223]; // Replace with actual course IDs

(async () => {
  try {
    const allAssignments = await canvas.getAllResultsFromArray('courses/<item>/assignments', courseIds);
    console.log('All assignments:', allAssignments);
  } catch (error) {
    console.error('Error fetching assignments for multiple courses:', error);
  }
})();
```

---

### 4. **`getSubmissions()`** - Fetching Student Submissions
This method simplifies fetching student submissions for assignments within a course, with optional filters for students and submission states.

#### Example: Get submissions for specific assignments in a course
```j
const courseId = 12345;
const assignmentIds = [56789, 67890]; // Replace with assignment IDs
const studentIds = [13579, 24680]; // Optional: Specific student IDs

(async () => {
  try {
    const submissions = await canvas.getSubmissions(courseId, assignmentIds, studentIds);
    console.log('Submissions:', submissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
  }
})();
```

---

### 5. **`handleConcurrentRequests()`** - Running Multiple API Requests Concurrently
This method allows you to send different types of requests at the same time, which is useful for reducing the time spent waiting on multiple unrelated API calls.

#### Example: Fetch course details, assignments, and users concurrently
```j
const courseId = 12345;

const requestConfigs = [
  canvas.createRequestConfig(`courses/${courseId}`, 'GET'),                 // Fetch course details
  canvas.createRequestConfig(`courses/${courseId}/assignments`, 'GET'),     // Fetch all assignments in the course
  canvas.createRequestConfig(`courses/${courseId}/users`, 'GET')            // Fetch all users in the course
];

(async () => {
  try {
    const [courseDetails, assignments, users] = await canvas.handleConcurrentRequests(requestConfigs);
    console.log('Course details:', courseDetails.data);
    console.log('Assignments:', assignments.data);
    console.log('Users:', users.data);
  } catch (error) {
    console.error('Error during concurrent requests:', error);
  }
})();
```
