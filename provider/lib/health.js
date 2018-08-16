var si = require('systeminformation');
var v8 = require('v8');
var request = require('request');
var _ = require('lodash');

module.exports = function(logger, utils) {

    // Health Endpoint
    this.endPoint = '/health';

    var triggerName;
    var monitorStatus;
    var alarmTypes = ['interval', 'date', 'cron'];
    var healthMonitor = this;

    // Health Logic
    this.health = function (req, res) {

        var stats = {triggerCount: Object.keys(utils.triggers).length};

        // get all system stats in parallel
        Promise.all([
            si.mem(),
            si.currentLoad(),
            si.fsSize(),
            si.networkStats(),
            si.inetLatency(utils.routerHost)
        ])
        .then(results => {
            stats.triggerMonitor = monitorStatus;
            stats.memory = results[0];
            stats.cpu = _.omit(results[1], 'cpus');
            stats.disk = results[2];
            stats.network = results[3];
            stats.apiHostLatency = results[4];
            stats.heapStatistics = v8.getHeapStatistics();
            res.send(stats);
        })
        .catch(error => {
            stats.error = error;
            res.send(stats);
        });
    };

    this.monitor = function(apikey) {
        var method = 'monitor';

        var auth = apikey.split(':');

        if (triggerName) {
            monitorStatus = Object.assign({}, utils.monitorStatus);
            var existingID = `/_/${triggerName}`;

            //delete trigger feed from database
            utils.sanitizer.deleteTriggerFromDB(existingID, 0);

            //delete the trigger
            var dataTrigger = {
                uri: utils.uriHost + '/api/v1/namespaces/_/triggers/' + triggerName,
                triggerID: existingID
            };
            utils.sanitizer.deleteTrigger(dataTrigger, auth, 0)
                .then((info) => {
                    logger.info(method, existingID, info);
                })
                .catch(err => {
                    logger.error(method, existingID, err);
                });
        }

        //create new alarm trigger
        triggerName = 'alarms_' + utils.worker + utils.host + '_' + Date.now();

        var triggerURL = utils.uriHost + '/api/v1/namespaces/_/triggers/' + triggerName;
        var triggerID = `/_/${triggerName}`;
        healthMonitor.createTrigger(triggerURL, auth)
            .then((info) => {
                logger.info(method, triggerID, info);
                var newTrigger = healthMonitor.createAlarmTrigger(triggerID, triggerName, apikey);
                healthMonitor.createTriggerInDB(triggerID, newTrigger);
            })
            .catch(err => {
                logger.error(method, triggerID, err);
            });
    };

    this.createAlarmTrigger = function(triggerID, triggerName, apikey) {
        var method = 'createAlarmTrigger';

        var existingTypeIndex = -1;
        if (monitorStatus && alarmTypes.indexOf(monitorStatus.triggerType) !== 2) {
            existingTypeIndex = alarmTypes.indexOf(monitorStatus.triggerType);
        }
        var alarmType = alarmTypes[existingTypeIndex + 1];

        //update status monitor object
        utils.monitorStatus.triggerName = triggerName;
        utils.monitorStatus.triggerType = alarmType;
        utils.monitorStatus.triggerStarted = false;
        utils.monitorStatus.triggerFired = false;
        utils.monitorStatus.triggerUpdated = false;

        var newTrigger = {
            apikey: apikey,
            name: triggerName,
            namespace: '_',
            payload: {},
            maxTriggers: -1,
            worker: utils.worker,
            monitor: utils.host
        };

        var currentDate = Date.now();
        if (alarmType === 'interval') {
            newTrigger.minutes = 1;
            newTrigger.startDate = currentDate + (1000 * 60);
            newTrigger.stopDate = currentDate + (1000 * 70);
        }
        else if (alarmType === 'date') {
            newTrigger.date = currentDate + (1000 * 60);
        }
        else {
            newTrigger.cron = '* * * * *';
            newTrigger.stopDate = currentDate + (1000 * 70);
        }

        return newTrigger;
    };

    this.createTrigger = function(triggerURL, auth) {
        var method = 'createTrigger';

        return new Promise(function(resolve, reject) {
            request({
                method: 'put',
                uri: triggerURL,
                auth: {
                    user: auth[0],
                    pass: auth[1]
                },
                json: true,
                body: {}
            }, function (error, response) {
                if (error || response.statusCode >= 400) {
                    reject('monitoring trigger create request failed');
                }
                else {
                    resolve('monitoring trigger create request was successful');
                }
            });
        });
    };

    this.createTriggerInDB = function(triggerID, newTrigger) {
        var method = 'createTriggerInDB';

        utils.db.insert(newTrigger, triggerID, function (err) {
            if (!err) {
                logger.info(method, triggerID, 'successfully inserted monitoring trigger');
            }
            else {
                logger.error(method, triggerID, err);
            }
        });
    };

};
