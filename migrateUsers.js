const CanvasMultiCurl = require('./CanvasMultiCurl');

// Initialize CanvasMultiCurl with access token and domain
const canvas = new CanvasMultiCurl(process.env.CANVAS_ACCESS_TOKEN, process.env.CANVAS_DOMAIN);

async function migrateUser(userId, oldCourseId, newCourseId) {
    console.log(`Migrating user ${userId} from course ${oldCourseId} to ${newCourseId}`);

    // Define the specific assignments we need
    const assignmentNames = [
        "Cotter’s Tool Score",
        "Preceptor Training Curriculum Complete",
        "Attend the Live Canvas Training",
        "Confirm All Tasks are Complete"
    ];

    const equivalentOldAssignments = [
        "Attend the Live Zoom Session",
        "Preceptor Live Class",
        "2-Hour Preceptor Training at Sequoia Hospital",
        "Canvas Preceptor Self-Paced Training and Quiz"
    ];

    // Fetch assignments from both courses
    const [oldAssignments, newAssignments] = await Promise.all([
        canvas.getList(`courses/${oldCourseId}/assignments`),
        canvas.getList(`courses/${newCourseId}/assignments`)
    ]);

    // Filter only relevant assignments
    const filteredOldAssignments = oldAssignments.filter(a => assignmentNames.includes(a.name) || equivalentOldAssignments.includes(a.name));
    const filteredNewAssignments = newAssignments.filter(a => assignmentNames.includes(a.name));

    // Map new assignments by name for quick lookup
    const newAssignmentsMap = filteredNewAssignments.reduce((acc, assignment) => {
        acc[assignment.name] = assignment.id;
        return acc;
    }, {});

    // Fetch user's submissions from old course
    const userSubmissions = await canvas.getSubmissions(oldCourseId, filteredOldAssignments.map(a => a.id), [userId]);

    let attendedLiveTraining = false;
    for (const submission of userSubmissions) {
        const oldAssignment = filteredOldAssignments.find(a => a.id === submission.assignment_id);
        if (!oldAssignment) continue;

        let newAssignmentId = null;
        let newScore = submission.score;
        let leaveUngraded = false;

        // Match old assignment names to new ones based on the provided rules
        if (newAssignmentsMap[oldAssignment.name]) {
            newAssignmentId = newAssignmentsMap[oldAssignment.name];
        } else if (equivalentOldAssignments.includes(oldAssignment.name)) {
            attendedLiveTraining = true;
        }

        if (newAssignmentId && newScore !== null) {
            await canvas.gradeItem(newCourseId, userId, newAssignmentId, newScore);
            console.log(`Transferred ${oldAssignment.name} (${submission.score}) to ${newAssignmentId} (${newScore})`);
        }
    }

    // If user completed any equivalent old training assignments, mark "Attend the Live Canvas Training" as complete
    if (attendedLiveTraining && newAssignmentsMap["Attend the Live Canvas Training"]) {
        await canvas.gradeItem(newCourseId, userId, newAssignmentsMap["Attend the Live Canvas Training"], 100);
        console.log(`Marked "Attend the Live Canvas Training" as complete for user ${userId}`);
    }

    // Special case: "Preceptor Training Curriculum Complete" does not exist in old course but should be graded 100/100
    if (newAssignmentsMap["Preceptor Training Curriculum Complete"]) {
        await canvas.gradeItem(newCourseId, userId, newAssignmentsMap["Preceptor Training Curriculum Complete"], 100);
        console.log(`Assigned 100/100 to "Preceptor Training Curriculum Complete" for user ${userId}`);
    }

    console.log(`Migration complete for user ${userId}`);
}

module.exports = { migrateUser };
