// Copyright 2017 Esri
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export default (request) => {
    // Authentication - see https://developers.arcgis.com/applications/new
    const clientID = 'YOUR CLIENTID';
    const clientSecret = 'YOUR CLIENT SECRET';

    // Configure these ArcGIS Feature Service end points. These are the User Point and GeoFence Polygon layers.
    const usersURL = 'YOUR USERS FEATURE SERVICE LAYER';
    const geofencesURL = 'YOUR GEOFENCES FEATURE SERVICE LAYER';

    const geofenceIDField = 'OBJECTID';
    const userIdField = 'OBJECTID';
    const userLastKnownFencesField = 'LastKnownGeofences';

    const publishEntry = true;
    const publishExit = true;
    const publishLocation = true;

    const query = require('codec/query_string');

    // return if the block does not have anything to analyze
    if (!query) {
        return request.ok();
    }

    const console = require('console');

    // Parse out the required parameters
    let userId = request.message.user;
    let newLat = request.message.lat;
    let newLng = request.message.lng;

    if (userId === undefined || newLat === undefined || newLng === undefined) {
        console.log('You must provide "user", "lat" and "lng" parameters!');
        return request.abort('You must provide "user", "lat" and "lng" parameters!');
        // Sample parameters to trigger notification when a user enters or leaves a geofence.
        // {
        //     "user": "D9A40B40-FD98-4CD0-8DFB-87C4C1D48C19",
        // 	   "lat": 40.756,
        //     "lng": -73.963,
        // }
    }

    // Require console to print debug information
    const pubnub = require("pubnub");
    const xhr = require('xhr');
    const promise = require('promise');

    // Alert any listeners (e.g. the Management App) of the driver's new Lat/Lng
    publishUserLocationMessage(userId, newLat, newLng);

    // Now do stuff with ArcGIS Online...
    return getToken(clientID, clientSecret).then(() => {
        const arcgisToken = request.message.arcgisToken;
        delete request.message.arcgisToken;
        // Find the last fences we saw the user in.
        let getLastFences = getLastKnownFencesForUser(userId, arcgisToken);

        // Get the fences that the updated lat/lng are in
        let getCurrentFences = getFencesForLocation(newLat, newLng, arcgisToken);

        // Figure out the difference. What was entered? What was left?
        return promise.all([getLastFences, getCurrentFences]).then((results) => {
            let currentFences = request.message.currentFences;
            let oldFences = request.message.oldFences;
            let enteredFences = currentFences.filter(function (newFence) {
                return oldFences.indexOf(newFence) < 0;
            });
            let exitedFences = oldFences.filter(function (oldFence) {
                return currentFences.indexOf(oldFence) < 0;
            });
            // console.log('Old fences', request.message.oldFences);
            // console.log('New fences', request.message.currentFences);
            // console.log('Entered', enteredFences);
            // console.log('Exited', exitedFences);
            request.message.enteredFences = enteredFences;
            request.message.exitedFences = exitedFences;

            if (enteredFences.length > 0) {
                publishFenceEntryMessage(userId, enteredFences);
            }

            if (exitedFences.length > 0) {
                publishFenceExitMessage(userId, exitedFences);
            }

            return updateUserWithGeofences(userId, currentFences, arcgisToken);
        }).catch((errs) => {
            console.log('Error happened fetching old and new geofences: ', errs);
            return request.abort();
        });
    }).catch((errs) => {
        console.log('Error getting token', errs);
        return request.abort();
    });


    // ArcGIS Functions
    function getFencesForLocation(lat, lng, token) {
        let currentFencesQueryParams = getGeofenceQueryParams(lat, lng, geofenceIDField);
        let queryCurrentFencesURL = `${geofencesURL}/query?${query.stringify(currentFencesQueryParams)}${tokenQuerystringParameter(token)}`;

        return xhr.fetch(queryCurrentFencesURL).then((response) => {
            return response.json().then((parsedResponse) => {
                // console.log('featuresForGeofence ', currentFencesQueryParams.where, parsedResponse.features);
                let currentGeofences = (parsedResponse.features || []).map(function (f) {
                    return `${f.attributes[geofenceIDField]}`;
                });
                request.message.currentFences = currentGeofences;
                return request.ok();
            }).catch((err) => {
                console.log('Error happened parsing the new geofences JSON', err);
                return request.abort();
            });
        }).catch((err) => {
            console.log('Error happened fetching the new geofences', err);
            return request.abort();
        });
    }

    function getLastKnownFencesForUser(userId, token) {
        let oldFencesQueryParams = getUserFencesQueryParams(userId, userIdField, userLastKnownFencesField);
        let queryOldFencesURL = `${usersURL}/query?${query.stringify(oldFencesQueryParams)}${tokenQuerystringParameter(token)}`;

        return xhr.fetch(queryOldFencesURL).then((response) => {
            return response.json().then((parsedResponse) => {
                if (parsedResponse.error) {
                    console.log(parsedResponse.error);
                    return request.abort();
                }

                if (parsedResponse.features.length == 0) {
                    console.log(`Could not find user ${userId}`);
                    return request.abort();
                }

                let feature = parsedResponse.features[0],
                    fencesStr = feature.attributes[userLastKnownFencesField] || '',
                    fences = fencesStr.length > 0 ? fencesStr.split(',') : [];

                request.message.oldFences = fences;
                request.message.existingUserOID = feature.attributes.OBJECTID;

                return request.ok();
            }).catch((err) => {
                console.log('Error happened parsing the old geofences response JSON', err);
                return request.abort();
            });
        }).catch((err) => {
            console.log('Error happened fetching the old geofences', err);
            return request.abort();
        });
    }

    function updateUserWithGeofences(userId, currentFences, token) {
        let userUpdateAction;
        let userJSON = {
            geometry: {
                'x': newLng,
                'y': newLat,
                'spatialReference': {
                    'wkid': 4326
                }
            },
            attributes: {}
        };

        if (currentFences !== undefined) {
            userJSON.attributes[userLastKnownFencesField] = currentFences.join();
        }

        if (request.message.existingUserOID === undefined) {

            // Adding new user
            userJSON.attributes[userIdField] = userId;
            userUpdateAction = "adds";

        } else {

            // Updating existing user (the record already has the UserID)
            userJSON.attributes.OBJECTID = request.message.existingUserOID;
            userUpdateAction = "updates";

        }

        // We don't need to pass this back.
        delete request.message.existingUserOID;

        let userUpdateBody = `f=json&${userUpdateAction}=${JSON.stringify(userJSON)}${tokenQuerystringParameter(token)}`;

        let postOptions = {
            "method": "POST",
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            "body": userUpdateBody
        };

        let addUpdateUserURL = `${usersURL}/applyEdits`;
        
        // Now update or create the user record with the current fences listed.            
        return xhr.fetch(addUpdateUserURL, postOptions).then((updateResponse) => {
            return updateResponse.json().then((parsedResponse) => {
                let result, writeType;

                if (parsedResponse.addResults.length > 0) {
                    result = parsedResponse.addResults[0];
                    writeType = "Add";
                } else if (parsedResponse.updateResults.length > 0) {
                    result = parsedResponse.updateResults[0];
                    writeType = "Update";
                } else {
                    console.log('No add or update result returned. This is unexpected.');
                    return request.abort('No add or update result returned. This is unexpected.');
                }

                if (result.success) {
                    // console.log(`${writeType} completed successfully for ${userId}`, result);
                    request.message.arcgisObjectId = result.objectId;
                    return request.ok();
                } else {
                    return request.abort('Add or Update user in ArcGIS failed.');
                }
            }).catch((err) => {
                console.log('Error happened on parsing the user update response JSON', err);
                return request.abort();
            });
        }).catch((err) => {
            console.log('Error happened POSTing a user update', err);
            return request.abort();
        });
    }


    // PubNub Publish Functions
    function publishFenceEntryMessage(userId, fences) {
        if (!publishEntry) return;

        // We're getting close to the user. Let them know!
        let channelId = `userEntered+${userId}`;
        let message = {
            userId: userId,
            fences: fences
        };

        console.log(`User Entered Fence(s) message on channel ${channelId}`);
        pubnub.publish({
            channel: channelId,
            message: message
        }).then((publishResponse) => {
            // console.log(`Publish Status: ${publishResponse[0]}:${publishResponse[1]} with TT ${publishResponse[2]}`);
        });
    }

    function publishFenceExitMessage(userId, fences) {
        if (!publishExit) return;

        // We're getting close to the user. Let them know!
        let channelId = `userExited+${userId}`;
        let message = {
            userId: userId,
            fences: fences
        };

        console.log(`User Exited Fence(s) message on channel ${channelId}`);
        pubnub.publish({
            channel: channelId,
            message: message
        }).then((publishResponse) => {
            // console.log(`Publish Status: ${publishResponse[0]}:${publishResponse[1]} with TT ${publishResponse[2]}`);
        });
    }

    function publishUserLocationMessage(userId, lat, lon) {
        if (!publishLocation) return;

        let channelId = `userLocation+${userId}`;
        let message = {
            userId: userId,
            lat: lat,
            lon: lon
        };

        // console.log(`User Location Update on channel ${channelId}`);
        pubnub.publish({
            channel: channelId,
            message: message
        }).then((publishResponse) => {
            // console.log(`Publish Status: ${publishResponse[0]}:${publishResponse[1]} with TT ${publishResponse[2]}`);
        });
    }


    // Token
    function tokenQuerystringParameter(token) {
        return token !== undefined ? `&token=${token}` : '';
    }

    function getToken(CLIENT_ID, CLIENT_SECRET) {
        const store = require('kvstore');

        return store.getItem('arcgisToken').then((value) => {
            // See if there is a token stored in the PubNub kvstore.
            if (value !== "null") {
                request.message.arcgisToken = value;
                return request.ok();
            } else {
                // There was no token stored (either we never got one, or it expired).
                const xhr = require('xhr');
                const url = "https://www.arcgis.com/sharing/rest/oauth2/token/";

                const http_options = {
                    "method": "POST",
                    "headers": {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },

                    "body": "&client_id=" + CLIENT_ID +
                        "&grant_type=client_credentials" +
                        "&client_secret=" + CLIENT_SECRET
                };

                // Make a POST request to get a token using the CLIENT_ID and CLIENT_SECRET.
                return xhr.fetch(url, http_options).then((x) => {
                    const body = JSON.parse(x.body);

                    // Store the token, and forget it 5 minutes before ArcGIS starts rejecting it.
                    store.setItem('arcgisToken', body.access_token, (body.expires_in / 60) - 5);
                    request.message.arcgisToken = body.access_token;

                    // console.log(`Stored new token to expire in ${(body.expires_in/60) - 5} minutes: ${body.access_token}`);

                    return request.ok();
                }).catch((x) => {
                    console.log("Exception in token xhr request: " + x);
                    return request.abort();
                });
            }
        });
    }
};

function getGeofenceQueryParams(lat, lng, idField) {
    // For more information on querying a feature service's layer, see:
    // http://resources.arcgis.com/en/help/arcgis-rest-api/#/Query_Feature_Service_Layer/02r3000000r1000000/
    // 
    // Here we'll query by geometry to see which geofences the updated user position falls within.
    return {
        geometryType: 'esriGeometryPoint',
        geometry: `${lng},${lat}`,
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: `${idField}`,
        returnGeometry: false,
        f: 'json'
    };
}

function getUserFencesQueryParams(userId, userIdField, lastKnownFencesField) {
    // For more information on querying a feature service's layer, see:
    // http://resources.arcgis.com/en/help/arcgis-rest-api/#/Query_Feature_Service_Layer/02r3000000r1000000/
    //
    // Here we query by UserID to get the last known geofences the user was within.
    return {
        where: `${userIdField} = '${userId}'`,
        outFields: `OBJECTID,${lastKnownFencesField}`,
        returnGeometry: false,
        resultRecordCount: 1,
        f: 'json'
    };
}