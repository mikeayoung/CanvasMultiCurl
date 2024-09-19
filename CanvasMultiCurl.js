const Bottleneck = require('bottleneck');
const axios = require('axios');

class CanvasMultiCurl {
    constructor(accessToken, domain, maxConcurrent = 10, minTime = 200) {
        this.accessToken = accessToken;
        this.domain = domain;

        // Initialize Bottleneck with the provided settings
        this.limiter = new Bottleneck({
            maxConcurrent: maxConcurrent, // Number of concurrent requests
            minTime: minTime // Minimum time between requests (in ms)
        });
    }

    // Helper function to prepare data by adding a prefix to each key
    prepareData(data, prefix) {
        if (typeof data === 'object' && !Array.isArray(data)) {
            data = { ...data }; // Ensure we are working with a plain object
        }

        if (!prefix) {
            return data;
        }

        const preparedData = {};
        preparedData[prefix] = data;
        return preparedData;
    }

    // Function to create a request configuration
    createRequestConfig(url, method = 'GET', data = null, prefix = null) {
        const config = {
            url: url,
            method: method.toUpperCase(),
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        // Handle POST and PUT methods
        if (['POST', 'PUT'].includes(config.method) && data) {
            const preparedData = this.prepareData(data, prefix);
            config.data = preparedData;
        }

        return config;
    }

    // Function to process a single request, with error handling and retry logic
    processRequest(config, retryCounts) {
        // Return the scheduled request as a promise
        return this.limiter.schedule(() => this.makeRequest(config))
            .then(response => {
                // Handle the response, especially checking for rate limits
                if (response && response.status === 403) {
                    // Rate limit reached, calculate retry delay
                    const retryDelay = this.calculateRetryDelay(response.headers);
                    console.error(`Rate limit reached, retrying ${config.url} in ${retryDelay} milliseconds...`);

                    // Increment retry count
                    retryCounts[config.url] = (retryCounts[config.url] || 0) + 1;

                    if (retryCounts[config.url] <= 5) {
                        // Delay the retry and then recursively call processRequest
                        return new Promise(resolve => setTimeout(resolve, retryDelay))
                            .then(() => this.processRequest(config, retryCounts)); // Retry the request
                    } else {
                        console.error(`Exceeded retry limit for ${config.url}`);
                        return null;
                    }
                }
                // If no rate limit issues, return the successful response
                return response;
            })
            .catch(error => {
                console.error(`Error during request to ${config.url}: ${error.message}`);
                return null;
            });
    }

    // Function to calculate retry delay based on rate limit headers
    calculateRetryDelay(headers) {
        const remaining = headers['x-rate-limit-remaining'];
        const requestCost = headers['x-request-cost'];

        if (remaining < 0) {
            const backoffTime = Math.abs(remaining) * 150;
            console.error(`Exceeded rate limit to the negative, backing off for ${backoffTime} milliseconds...`);
            return backoffTime;
        }

        if (remaining && requestCost) {
            return Math.ceil((300 / remaining) * 500 * requestCost);
        }

        return 1000; // Default retry delay of 1 second
    }

    // Generic multi-threaded function to get a list from an API endpoint
    async getList(url, vars = false, perPage = 100, maxBatchSize = 40, batchDelay = 300, item = null) {
        const allResults = [];
        let page = 1;
        const preparedUrl = `${url}${vars ? '&' : '?'}`;
        const initialUrl = `${this.domain}/api/v1/${preparedUrl}page=${page}&per_page=${perPage}`;

        try {
            // Initial request to determine total pages
            const initialResponse = await this.processRequest(this.createRequestConfig(initialUrl, 'GET'), {});

            if (!initialResponse || !initialResponse.data) {
                throw new Error('Failed to fetch initial data.');
            }

            const { headers, data: initialResults } = initialResponse;

            // Process initial results
            if (!item) {
                allResults.push(...initialResults);
            } else {
                initialResults.forEach(initialResult => {
                    if (initialResult[item] && initialResult.id) {
                        if (!allResults[initialResult.id]) {
                            allResults[initialResult.id] = {};
                        }
                        allResults[initialResult.id][item] = initialResult[item];
                    }
                });
            }

            // Determine total pages or bookmark-based pagination
            let totalPages = 1;
            let lastPageKnown = false;
            let nextbookmarkURL = false;
            let queryParams = '';

            const lastPageUrl = this.getPageUrl(headers['link'], 'last');
            if (lastPageUrl) {
                queryParams = new URLSearchParams(lastPageUrl.split('?')[1]);
                totalPages = queryParams.get('page') || 1;
                if(totalPages == 'first')
                {
                  //uh oh, it's bookmarks! but it's ok here because if there's a last page and it's the first page, it's 1 page
                  totalPages = 1;
                } else {
                  lastPageKnown = true;
                }
            } else {
                const nextPageUrl = this.getPageUrl(headers['link'], 'next');
                if (nextPageUrl) {
                  queryParams = new URLSearchParams(nextPageUrl.split('?')[1]);
                  let nextPage = queryParams.get('page');
                  if (nextPage.includes('bookmark'))
                  {
                    //ugh it's a bookmark, we must go step by step
                    nextbookmarkURL = nextPageUrl;
                    totalPages = 2;
                  } else {
                    //if no, it's time to start speculative concurrency!
          					//we can start conservatively by making 2 concurrent calls and ramp up exponentially
                    totalPages = nextPage + 1;
                  }
                }
            }

            if (totalPages == 1) {
                return allResults;
            }

            // Multi-threaded batch processing
            let retryCounts = {};
            // if we keep going, there is more than 1 page, so let's start on page 2
            page = 2;
            while (page <= totalPages || Object.keys(retryCounts).length > 0) {
                const batchRequests = [];
                if (!nextbookmarkURL) {
                    for (let i = 0; i < maxBatchSize && page <= totalPages; i++, page++) {
                        const batchUrl = `${this.domain}/api/v1/${preparedUrl}page=${page}&per_page=${perPage}`;
                        batchRequests.push(this.processRequest(this.createRequestConfig(batchUrl, 'GET'), retryCounts));
                    }
                } else {
                    batchRequests.push(this.processRequest(this.createRequestConfig(nextbookmarkURL, 'GET'), retryCounts));
                    page++;
                }

                // Wait for all the requests in this batch to complete
                const responses = await Promise.all(batchRequests);

                // Process the responses after all requests have completed
                for (const response of responses) {
                    if (response && response.data) {
                        const results = response.data;

                        if (!item) {
                            allResults.push(...results);
                        } else {
                            results.forEach(result => {
                                if (result[item] && result.id) {
                                    if (!allResults[result.id]) {
                                        allResults[result.id] = {};
                                    }
                                    allResults[result.id][item] = result[item];
                                }
                            });
                        }

                        // Handle pagination updates
                        if (!lastPageKnown && results.length >= perPage) {
                          //last page might show up later
                          const lastPageUrl = this.getPageUrl(headers['link'], 'last');
                          if (lastPageUrl) {
                              queryParams = new URLSearchParams(lastPageUrl.split('?')[1]);
                              lastPage = queryParams.get('page');
                              if(!lastPage.includes('bookmark'))
                              {
                                totalPages = parseInt(queryParams.get('page'));
                                lastPageKnown = true;
                              } //if the last page is a bookmark, the next page will be too
                          } else {
                            const nextPageUrl = this.getPageUrl(response.headers['link'], 'next');
                            if (!results.length || !nextPageUrl) {
                                totalPages = page - 1;
                                lastPageKnown = true;
                            } else {
                                if (nextPage.includes('bookmark'))
                                {
                                  //ugh it's a bookmark, we must go step by step
                                  nextbookmarkURL = nextPageUrl;
                                  totalPages++
                                } else {
                                  totalPages += 10; // Speculative increment
                                }
                            }
                          }
                        }
                    }
                }

                // Delay before processing the next batch
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }

            return allResults;
        } catch (error) {
            console.error(`Error in getList: ${error.message}`);
            throw error;
        }
    }

    // Function to handle multiple concurrent requests using processRequest
    async handleConcurrentRequests(requestConfigs) {
        const retryCounts = {}; // Track retries for each request

        try {
            // Map each requestConfig to a call to processRequest
            const promises = requestConfigs.map(config =>
                this.processRequest(config, retryCounts)
            );

            // Wait for all requests to complete concurrently
            const results = await Promise.all(promises);
            return results;
        } catch (error) {
            console.error('Error during concurrent requests:', error.message);
            throw error;
        }
    }

    // Helper function to extract page URL from Link header
    getPageUrl(linkHeader, rel) {
        if (!linkHeader) return null;
        const regex = new RegExp(`<([^>]+)>;\\s*rel="${rel}"`);
        const match = linkHeader.match(regex);
        return match ? match[1] : null;
    }

    // Function to make an HTTP request
    async makeRequest(config) {
        try {
            const response = await axios(config);
            return {
                status: response.status,
                headers: response.headers,
                data: response.data
            };
        } catch (error) {
            console.error(`Error during request to ${config.url}: ${error.message}`);
            return null;
        }
    }

    // Wrapper function to combine createRequestConfig and makeRequest
    async request(url, method = 'GET', data = null, prefix = null) {
        const config = this.createRequestConfig(`${this.domain}/api/v1/${url}`, method, data, prefix);
        return this.makeRequest(config);
    }

    //get submissions
    async getSubmissions(courseid, assignmentids, students = false) {
        const assignmentList = assignmentids.map(id => `assignment_ids[]=${id}`).join('&');

        if (!students) {
            return this.getList(`courses/${courseid}/students/submissions?${assignmentList}`);
        } else {
            const buildlist = students.reduce((acc, student) => acc + `&student_ids[]=${student}`, '');
            return this.getList(`courses/${courseid}/students/submissions?${assignmentList}${buildlist}`, true);
        }
    }

    async getAllResultsFromArray(basePattern, items, vars = false, perPage = 100, maxBatchSize = 40, batchDelay = 500) {
        const allResults = {};
        const retryCounts = {};
        const totalPages = {};
        const lastPageKnown = {};
        const templateUrl = basePattern + (vars ? '&' : '?') + `per_page=${perPage}`;

        let currentBatch = [];
        let currentIndex = 0;

        while (currentIndex < items.length || currentBatch.length > 0) {
            // Fill the batch with up to maxBatchSize requests, but ensure currentBatch isn't overfilled
            for (let i = 0; i < maxBatchSize && currentIndex < items.length && currentBatch.length < maxBatchSize; i++, currentIndex++) {
                const item = items[currentIndex];
                const initialUrl = templateUrl.replace('<item>', item);
                retryCounts[initialUrl] = 0;
                totalPages[item] = 1;
                lastPageKnown[item] = false;

                const config = this.createRequestConfig(initialUrl, 'GET');
                currentBatch.push(config);
            }

            // If the batch is full or no more items to process, execute the batch
            if (currentBatch.length >= maxBatchSize || currentIndex >= items.length) {

                let batchResults = [];

                // Handle currentBatch being > maxBatchSize as a result of large numbers of pages
                if (currentBatch.length > maxBatchSize) {
                  // Loop through currentBatch and process a max of 40 requests at once
                  for (let i = 0; i < currentBatch.length; i += maxBatchSize) {
                      const batchChunk = currentBatch.slice(i, i + maxBatchSize);
                      const chunkResults = await this.handleConcurrentRequests(batchChunk);
                      batchResults = batchResults.concat(chunkResults); // Collect results from each chunk
                  }
                } else {
                  // If the batch is within limits, process it directly
                  batchResults = await this.handleConcurrentRequests(currentBatch);
                }

                // Reset the batch for the next set of requests
                currentBatch = [];

                for (const result of batchResults) {
                    if (result && result.status === 200) {
                        const itemUrl = result.config.url;
                        const item = items.find(it => itemUrl.includes(it));
                        const currentResults = allResults[item] || [];

                        if (Array.isArray(result.data)) {
                            allResults[item] = currentResults.concat(result.data);
                        } else {
                            allResults[item] = result.data;
                        }

                        //do we know the last page? and are there results >= perPage (suggesting there might be more pages)?
                        if(!lastPageKnown[item] && result.data.length >= perPage)
                        {
                          const lastPageUrl = this.getPageUrl(result.headers['link'], 'last');
                          const nextPageUrl = this.getPageUrl(result.headers['link'], 'next');
                          const currentPageUrl = this.getPageUrl(result.headers['link'], 'current');

                          if (lastPageUrl) {
                              const queryParams = new URLSearchParams(lastPageUrl.split('?')[1]);
                              const lastPage = queryParams.get('page');
                              if(!lastPage.includes('bookmark') && !lastPage.includes('first'))
                              {
                                totalPages[item] = parseInt(queryParams.get('page')) || 1;
                                lastPageKnown[item] = true;

                                //sometimes last page doesn't show up at first, so we need to let page = currentPage

                                let currentPage = 1;
                                if(currentPageUrl)
                                {
                                  const cpqueryParams = new URLSearchParams(currentPageUrl.split('?')[1]);
                                  currentPage = cpqueryParams.get('page');
                                }

                                for (let page = currentPage; page <= totalPages[item]; page++) {
                                    const pageUrl = `${templateUrl.replace('<item>', item)}page=${page}`;
                                    const pageConfig = this.createRequestConfig(pageUrl, 'GET');
                                    currentBatch.push(pageConfig);
                                }
                              } //if lastPage has a bookmark, so does nextPage

                          } else if (nextPageUrl) {
                              const queryParams = new URLSearchParams(nextPageUrl.split('?')[1]);
                              const nextPage = queryParams.get('page');

                              if (!nextPage.includes('bookmark')) {
                                  //speculate!

                                  let currentPage = 1;
                                  if(currentPageUrl)
                                  {
                                    const cpqueryParams = new URLSearchParams(currentPageUrl.split('?')[1]);
                                    currentPage = parseInt(cpqueryParams.get('page'));
                                  }

                                  if(currentPage > totalPages[item])
                                  {
                                    totalPages[item] = totalPages[item] + 10;

                                    for (let page = currentPage + 1; page <= totalPages[item]; page++) {
                                        const pageUrl = `${templateUrl.replace('<item>', item)}page=${page}`;
                                        const pageConfig = this.createRequestConfig(pageUrl, 'GET');
                                        currentBatch.push(pageConfig);
                                    }
                                  }
                              } else {
                                //ugh bookmarks
                                totalPages[item]++;
                                const pageConfig = this.createRequestConfig(nextPageUrl, 'GET');
                                currentBatch.push(pageConfig);
                              }
                          }
                        }
                    } else {
                        console.error(`Failed to fetch data for ${result.config.url}:`, result ? result.status : 'unknown error');
                    }
                }

                // Delay before processing the next batch
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        return allResults;
    }
}

// Export the CanvasMultiCurl class for use in other files
module.exports = CanvasMultiCurl;
