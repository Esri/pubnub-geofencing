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
    // TODO:
    // Create a new app at https://developers.arcgis.com/applications/new
    // Use the new app's App ID and App Secret below.
    const clientID = 'YOUR CLIENTID';
    const clientSecret = 'YOUR CLIENT SECRET';

    // Configure these ArcGIS Feature Service end points. These are the Asset Point and GeoFence Polygon layers.
    // TODO:
    // Create an Asset Points Feature Service and Geofence Polygons Feature Service in ArcGIS Online.
    // See https://github.com/esri/pubnub-geofencing for more details.
    const assetsURL = 'YOUR ASSET LOCATIONS FEATURE SERVICE LAYER';
    const geofencesURL = 'YOUR GEOFENCES FEATURE SERVICE LAYER';

    const geofenceIDField = 'OBJECTID';
    const assetIdField = 'OBJECTID';
    const assetLastKnownFencesField = 'LastKnownGeofences';

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
    let assetId = request.message.asset;
    let newLat = request.message.lat;
    let newLng = request.message.lng;

    if (assetId === undefined || newLat === undefined || newLng === undefined) {
        console.log('You must provide "asset", "lat" and "lng" parameters!');
        return request.abort('You must provide "asset", "lat" and "lng" parameters!');
        // Sample parameters to trigger notification when a asset enters or leaves a geofence.
        // {
        //     "asset": "D9A40B40-FD98-4CD0-8DFB-87C4C1D48C19",
        // 	   "lat": 40.756,
        //     "lng": -73.963,
        // }
    }

    // Require console to print debug information
    const pubnub = require("pubnub");
    const xhr = require('xhr');
    const promise = require('promise');

    // Alert any listeners (e.g. the Management App) of the driver's new Lat/Lng
    publishAssetLocationMessage(assetId, newLat, newLng);

    // Now do stuff with ArcGIS Online...
    return getToken(clientID, clientSecret).then(() => {
        const arcgisToken = request.message.arcgisToken;
        delete request.message.arcgisToken;
        // Find the last fences we saw the asset in.
        let getLastFences = getLastKnownFencesForAsset(assetId, arcgisToken);

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
                publishFenceEntryMessage(assetId, enteredFences);
            }

            if (exitedFences.length > 0) {
                publishFenceExitMessage(assetId, exitedFences);
            }

            return updateAssetWithGeofences(assetId, currentFences, arcgisToken);
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

    function getLastKnownFencesForAsset(assetId, token) {
        let oldFencesQueryParams = getAssetFencesQueryParams(assetId, assetIdField, assetLastKnownFencesField);
        let queryOldFencesURL = `${assetsURL}/query?${query.stringify(oldFencesQueryParams)}${tokenQuerystringParameter(token)}`;

        return xhr.fetch(queryOldFencesURL).then((response) => {
            return response.json().then((parsedResponse) => {
                if (parsedResponse.error) {
                    console.log(parsedResponse.error);
                    return request.abort();
                }

                if (parsedResponse.features.length == 0) {
                    console.log(`Could not find asset ${assetId}`);
                    return request.abort();
                }

                let feature = parsedResponse.features[0],
                    fencesStr = feature.attributes[assetLastKnownFencesField] || '',
                    fences = fencesStr.length > 0 ? fencesStr.split(',') : [];

                request.message.oldFences = fences;
                request.message.existingAssetOID = feature.attributes.OBJECTID;

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

    function updateAssetWithGeofences(assetId, currentFences, token) {
        let assetUpdateAction;
        let assetJSON = {
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
            assetJSON.attributes[assetLastKnownFencesField] = currentFences.join();
        }

        if (request.message.existingAssetOID === undefined) {

            // Adding new asset
            assetJSON.attributes[assetIdField] = assetId;
            assetUpdateAction = "adds";

        } else {

            // Updating existing asset (the record already has the AssetID)
            assetJSON.attributes.OBJECTID = request.message.existingAssetOID;
            assetUpdateAction = "updates";

        }

        // We don't need to pass this back.
        delete request.message.existingAssetOID;

        let assetUpdateBody = `f=json&${assetUpdateAction}=${JSON.stringify(assetJSON)}${tokenQuerystringParameter(token)}`;

        let postOptions = {
            "method": "POST",
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            "body": assetUpdateBody
        };

        let addUpdateAssetURL = `${assetsURL}/applyEdits`;
        
        // Now update or create the asset record with the current fences listed.            
        return xhr.fetch(addUpdateAssetURL, postOptions).then((updateResponse) => {
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
                    // console.log(`${writeType} completed successfully for ${assetId}`, result);
                    request.message.arcgisObjectId = result.objectId;
                    return request.ok();
                } else {
                    return request.abort('Add or Update asset in ArcGIS failed.');
                }
            }).catch((err) => {
                console.log('Error happened on parsing the asset update response JSON', err);
                return request.abort();
            });
        }).catch((err) => {
            console.log('Error happened POSTing a asset update', err);
            return request.abort();
        });
    }


    // PubNub Publish Functions
    function publishFenceEntryMessage(assetId, fences) {
        if (!publishEntry) return;

        let channelId = `assetEntered+${assetId}`;
        let message = {
            assetId: assetId,
            fences: fences
        };

        console.log(`Asset Entered Fence(s) message on channel ${channelId}`);
        pubnub.publish({
            channel: channelId,
            message: message
        }).then((publishResponse) => {
            // console.log(`Publish Status: ${publishResponse[0]}:${publishResponse[1]} with TT ${publishResponse[2]}`);
        });
    }

    function publishFenceExitMessage(assetId, fences) {
        if (!publishExit) return;

        let channelId = `assetExited+${assetId}`;
        let message = {
            assetId: assetId,
            fences: fences
        };

        console.log(`Asset Exited Fence(s) message on channel ${channelId}`);
        pubnub.publish({
            channel: channelId,
            message: message
        }).then((publishResponse) => {
            // console.log(`Publish Status: ${publishResponse[0]}:${publishResponse[1]} with TT ${publishResponse[2]}`);
        });
    }

    function publishAssetLocationMessage(assetId, lat, lon) {
        if (!publishLocation) return;

        let channelId = `assetLocation+${assetId}`;
        let message = {
            assetId: assetId,
            lat: lat,
            lon: lon
        };

        // console.log(`Asset Location Update on channel ${channelId}`);
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
    // Here we'll query by geometry to see which geofences the updated asset position falls within.
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

function getAssetFencesQueryParams(assetId, assetIdField, lastKnownFencesField) {
    // For more information on querying a feature service's layer, see:
    // http://resources.arcgis.com/en/help/arcgis-rest-api/#/Query_Feature_Service_Layer/02r3000000r1000000/
    //
    // Here we query by AssetID to get the last known geofences the asset was within.
    return {
        where: `${assetIdField} = '${assetId}'`,
        outFields: `OBJECTID,${lastKnownFencesField}`,
        returnGeometry: false,
        resultRecordCount: 1,
        f: 'json'
    };
}