const timer = require('timers');
const { ErrorHelper, Constants } =  require('eae-utils');

/**
 * @class JobsWatchdog
 * @desc Periodic monitoring of jobs - Archive completed jobs, Invalidate timing out jobs
 * @param mongoHelper Helper class to interact with Mongo
 * @param swiftHelper Helper class to interact with Swift
 * @constructor
 */
function JobsWatchdog(mongoHelper, swiftHelper) {
    //Init member vars
    this._intervalTimeout = null;
    this._mongoHelper = mongoHelper;
    this._swiftHelper = swiftHelper;

    //Bind member functions
    this.startPeriodicUpdate = JobsWatchdog.prototype.startPeriodicUpdate.bind(this);
    this.stopPeriodicUpdate = JobsWatchdog.prototype.stopPeriodicUpdate.bind(this);

    // Action Methods
    this._archiveJobs = JobsWatchdog.prototype._archiveJobs.bind(this);
    // this._invalidateTimingOutJobs = JobsWatchdog.prototype._invalidateTimingOutJobs.bind(this);
}

/**
 * @fn _archiveJob
 * @desc
 *
 */
JobsWatchdog.prototype._archiveJobs = function(){
    let _this = this;
    return new Promise(function(resolve, reject) {
        let statuses = [Constants.EAE_JOB_STATUS_COMPLETED];
        var currentTime = new Date();

        let filter = {
            status: {$in: statuses},
            statusLock: false,
            endDate: {
                '$lt': new Date(currentTime.setHours(currentTime.getHours() - global.eae_scheduler_config.jobsExpiredStatusTime))
            }
        };

        _this._mongoHelper.retrieveJobs(filter).then(function (jobs) {
            jobs.forEach(function (job) {
                let filter = {
                    _id: job._id
                };
                let fields = {
                    statusLock: true
                };
                // lock the node
                _this._mongoHelper.updateJob(filter, fields).then(
                    function (res) {
                        if(res.nModified === 1){
                            // We archive the Job
                            _this._mongoHelper.archiveJob(job._id);
                            // We purge the results from swift
                            _this._swiftHelper.delete();
                            // #TODO purge swift both input, output
                            resolve('The job has been successfully archived');
                        }else{
                            resolve('The job has already been updated');
                        }},
                    function (error) {
                        reject(ErrorHelper('Failed to lock the job. Filter:' + filter.toString(), error));
                    });
            });
        },function (error){
           reject(ErrorHelper('Failed to retrieve Jobs. Filter:' + filter.toString(), error));
        });
    });
};

/**
 * @fn startPeriodicUpdate
 * @desc Start an automatic update and synchronisation of the compute status of the nodes
 * @param delay The intervals (in milliseconds) on how often to update the status
 */
JobsWatchdog.prototype.startPeriodicUpdate = function(delay = Constants.statusDefaultUpdateInterval) {
    let _this = this;

    //Stop previous interval if any
    _this.stopPeriodicUpdate();
    //Start a new interval update
    _this._intervalTimeout = timer.setInterval(function(){
        _this._archiveJobs(); // Purge expired jobs
    }, delay);
};

/**
 * @fn stopPeriodicUpdate
 * @desc Stops the automatic update and synchronisation of the compute status of the nodes
 * Does nothing if the periodic update was not running
 */
JobsWatchdog.prototype.stopPeriodicUpdate = function() {
    let _this = this;

    if (_this._intervalTimeout !== null && _this._intervalTimeout !== undefined) {
        timer.clearInterval(_this._intervalTimeout);
        _this._intervalTimeout = null;
    }
};

module.exports = JobsWatchdog;