# CanvasMultiCurl
Node.js library that uses Bottleneck and Axios to handle concurrent calls to Canvas LMS API. Uses backoff delays if it hits 403 throttles and various calculations for efficiency.

Built in the thick of many real-world Canvas tasks. Still very much a work in progress. No guarantees that anything will work or won't hopelessly erase all your Canvas data etc. Be adventurous; have fun; etc. Please feel free to make pull requests and improvements as needed. Big thanks to [James Jones] (https://community.canvaslms.com/t5/user/viewprofilepage/user-id/105160) for his tips and tricks and help with speculative concurrency.

Notes:

1) Handles bookmarks sequentially. Speculative concurrency is hard with bookmarks on purpose because Canvas doesn't want you hogging the API, which is fair. If you want to dive in, you might start with [https://community.canvaslms.com/t5/Canvas-Developers-Group/Submissions-API-not-returning-all-submissions/m-p/51725] (this Canvas post), where James explains that bookmarks are Base64 JSON strings, and in theory if you know how your data results are being sorted, you could do speculative concurrency with bookmarks.
2) getList if you need a list from one endpoint; getAllResultsFromArray if you need something like all the assignments in a list of courses (be careful about memory limits and all that if you're getting big objects like submissions)
3) getSubmissions is really the only "helper" function because I found myself getting submissions so often. But you could go to town with other levels of abstraction if you want!
