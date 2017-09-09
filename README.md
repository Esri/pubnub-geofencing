# Overview
A PubNub Block that uses ArcGIS services to implement realtime geofence triggering behaviour.

# Features
* Serverless architecture using ArcGIS Online and PubNub cloud solutions.
* PubNub Function for realtime geofence-based entry and exit triggering.
* Secure communication between PubNub Function and ArcGIS Online.
* Extensible to suit your needs.

# Prerequisites
* [Free ArcGIS Developer account](https://developers.arcgis.com/sign-up).
* Free PubNub account.

# Behavior

The PubNub Function requires an ArcGIS polygon feature service that represents geofences, and a point feature service that represents user locations.

Passing a user ID and their current location to the PubNub Function will return whether the user has entered or exited any geofences since the last call. It will also update the user's location record with the new location (and current geofence information).

# Instructions

Follow the [Set Up](#set-up) steps below to get your PubNub function and ArcGIS Online services operating together.

The default insructions cover the simple case. For custom configuration of fields for tracking locations and geofences, see the [Customization](#customization) section

## Set up
There are 3 components to set up:
1. ArcGIS Online Services
2. ArcGIS Online OAuth Application
3. PubNub Function

Get started with a simple setup:

### 1. Publish ArcGIS Online Services

1. Sign in at [www.arcgis.com](https://www.arcgis.com).

2. Publish the [SimpleGeofencing.sd](Sample%20Service%20Definitions/SimpleGeofencing.sd) Service Definition to your ArcGIS Online account. Browse to your "[My Content](https://arcgis.com/home/content.html)" tab. Select `Add Item` > `From my computer` and upload the file, ensuring the `Publish this file as a hosted layer` checkbox is selected.

3. Once published, you will be redirected to the new service's Portal Item page. Make a note of the `Service URL` for the `UserLocations` and `Geofences` layers on the new published service (be sure to remove the `?token=...` from the end of each URL).

### 2. Create ArcGIS Online OAuth Application
1. Browse to your "[My Content](https://arcgis.com/home/content.html)" tab and select `Add Item` > `An application`, and select the `Application` radio button. Fill in the fields.

2. Under the `Settings` tab of the new Application, click the `Registered Info` button in the `Application Settings` panel. Make a note of the `App ID` and `App Secret` values.

### 3. PubNub Function
1. Create a new PubNub Function with the contents of the [location-geofencing.js](location-geofencing.js) file.

2. Update the `usersURL` and the `geofencesURL` consts with the URLs noted in Step 1. Be sure not to include any URL parameters. The URLs should end in `/0` or `/1` for the samples provided.

3. Update the `clientID` and `clientSecret` consts with the **App ID** and **App Secret** noted in Step 2.

That's it. You can now Start your PubNub Function and begin using it.

## Editing Geofences
There is no specific tool provided with this sample to edit the geofences, however you can use the ArcGIS Online Map Viewer to create, edit and delete geofences.

To do this, navigate to the Portal Item page created when the service was published in Step 1.3, expand the drop down `Open in Map Viewer` and pick `Add layer to new map with full editing control`. For instructions on how to edit the data, see [here](http://doc.arcgis.com/en/arcgis-online/create-maps/edit-features.htm).

## Customization

The Geofences service must include a unique ID field. This can be system-managed (such as the default `OBJECTID` field that ArcGIS Online creates) or a custom ID field.

The Locations service must include two fields. A unique ID field, and a string field to store Geofence IDs. This latter field is used to determine whether an updated location represents a move into or out of a geofence.

By default, the `SimpleGeofencing.sd` Service Definition makes use of the `OBJECTID` fields. These are integer IDs for each location and geofence. Often you will want to use your own IDs. The [CustomGeofencing.sd](Sample%20Service%20Definitions/CustomGeofencing.sd) shows an example of this. To set it up:

1. Follow Step 1 above to publish the [CustomGeofencing.sd](Sample%20Service%20Definitions/CustomGeofencing.sd) instead of the SimpleGeofencing.sd.
2. Follow Step 3 to configure the PubNub function. You can reuse the same application from Step 2.
3. Customize the `geofenceIDField`, `userIdField` and `userLastKnownFencesField` consts in the PubNub Function to reference the custom location and geofence tracking fields:

| Variable | Field Name |
| -------- | ---------- |
| `geofenceIDField` | `FenceID` |
| `userIdField` | `UserID` |
| `userLastKnownFencesField` | `LastGeofenceIDs` |

**Note:** While the custom service still uses `OBJECTID` as row identifiers, the geofencing logic uses other fields to track the geofencing. This is useful if fences and locations are related to records coming from other systems.

For reference, the above variable configuration table would look like this for the SimpleGeofencing service definition:

| Variable | Field Name |
| -------- | ---------- |
| `geofenceIDField` | `OBJECTID` |
| `userIdField` | `OBJECTID` |
| `userLastKnownFencesField` | `LastKnownGeofences` |

The most important thing here is to understand how many geofences a location can be within at any one time. If the geofences do not overlap, that number is `1`. The `userLastKnownFencesField` field length must be long enough to contain the IDs (read from the `geofenceIDField` field) of all the geofences a location can be in at once, with commas between them.

**Note:** The sample data creates two layers within a single service. This is by no means a requirement. For example, if the layers are created using the [New Layer](https://developers.arcgis.com/layers/new/) developer tool, each will belong to a separate service.

# Sample Data
The two sample Service Definitions include 1 user and 3 geofences each. The geofences are in Manhattan at Union Square, Gramercy Park, and the dog park at Union Square. Since the Dog Park is within Union Square, the geofences could potentially overlap.

The test User ID is:
* SimpleGeofencing: `1`
* CustomGeofencing: `jackdoe@awesomecorp.com`

To test entering and exiting the fences, use the following payloads in your PubNub Function Editor (modify the user values as appropriate depending on whether you're using the SimpleGeofencing layers or the CustomGeofencing layers):

* Gramercy Park:
	``` JSON
	{
		"user": "1",
		"lat": 40.73795,
		"lng": -73.98688
	}
	```

* Union Square:
	``` JSON
	{
		"user": "1",
		"lat": 40.73709,
		"lng": -73.9902
	}
	```

* Union Square Dog Park
	``` JSON
	{
		"user": "1",
		"lat": 40.7356,
		"lng": -73.991
	}
	```

*  No Geofence
	``` JSON
	{
		"user": "1",
		"lat": 40.73836,
		"lng": -73.9899
	}
	```

Test each of those payloads and see how the JSON output of the PubNub function describes the geofences that were entered and exited.

## Contributing
Anyone and everyone is welcome to [contribute](https://github.com/Esri/maps-app-ios/blob/master/CONTRIBUTING.md). We do accept pull requests.

1. Get involved
2. Report issues
3. Contribute code
4. Improve documentation

## Licensing
Copyright 2017 Esri

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

A copy of the license is available in the repository's [license.txt](/license.txt) file.
