const CanvasMultiCurl = require('./CanvasMultiCurl');

// Configuration
const accessToken = '21476~JtxO2yW8x7XJthJxvwXyUIDG7K8ppGPwDjLJC4Kx4b02SHYHqPArfmNAZ0BnL3Af'; // Replace with your Canvas API token
const domain = 'https://csh-dhge.instructure.com'; // Replace with your Canvas instance domain

const canvas = new CanvasMultiCurl(accessToken, domain);

async function enrollAndGradeUser(userId, courseId) {
    console.log(`Enrolling user ${userId} in course ${courseId}`);

    // Enroll the user in the course
    await canvas.request(`courses/${courseId}/enrollments`, 'POST', {
        enrollment: {
            user_id: userId,
            type: "StudentEnrollment",
            enrollment_state: "active"
        }
    });
    console.log(`User ${userId} enrolled in course ${courseId}`);

    // Get all assignments in the course
    const assignments = await canvas.getList(`courses/${courseId}/assignments`);

    // Generate random scores (some with no scores at all)
    for (const assignment of assignments) {
        const score = Math.random() > 0.3 ? Math.floor(Math.random() * 101) : null; // 30% chance of being ungraded

        if (score !== null) {
            await canvas.gradeItem(courseId, userId, assignment.id, score);
            console.log(`Assigned score ${score}/100 for assignment: ${assignment.name}`);
        } else {
            console.log(`Skipped grading for assignment: ${assignment.name} (left ungraded)`);
        }
    }

    console.log(`Grading process complete for user ${userId} in course ${courseId}`);
}

// Run the script
(async () => {
    const userId = 11259;
    const courseId = 1279;
    await enrollAndGradeUser(userId, courseId);
})();
