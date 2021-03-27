import { useRef, useEffect, useState } from 'react';
import './App.css';
import mapboxgl, { accessToken, TouchZoomRotateHandler } from 'mapbox-gl'
import * as turf from '@turf/turf'
import firebase from 'firebase/app'
// Required for side-effects
import "firebase/firestore"
import "firebase/auth"
import "firebase/database"
const axios = require('axios')

var userId
var userName
var masterData = {
  "progress": [],
  "routes": []
}

var firebaseConfig = {
  apiKey: "AIzaSyAPW1QJrT8E00LnumQDfIIKQNsiJhXis9w",
  authDomain: "mapme-6bf21.firebaseapp.com",
  projectId: "mapme-6bf21",
  storageBucket: "mapme-6bf21.appspot.com",
  messagingSenderId: "497484009786",
  appId: "1:497484009786:web:b5691b0774a289b0e08003"
}

firebase.initializeApp(firebaseConfig)
firebase.firestore().enablePersistence()

var db = firebase.firestore()
var provider = new firebase.auth.GoogleAuthProvider()

var token = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;
var coordinates = {
  'source': {
    lon: 0.1011,
    lat: 50.7735
  },
  'destination': {
    lon: -2.5879,
    lat: 51.4545
  },
  'stops': {
    stops: [[0, 0]]
  }
}

var progressCoordinates = [
  {
    destinationLon: coordinates['source'].lon,
    destinationLat: coordinates['source'].lat
  }
]

//map options
var routeColor = "#888"
var routeLineWidth = 4
var progressColor = "#ff7979"
var markerColor = "#ff7979"
var zoomLevel = 6

var leg = 0
var routePrefix = "route"
var currentRouteId = routePrefix + String(leg)
var activeRoute = ""
var lastDestination = ""
var routeData = {
}
var currentLocation = []
var currentDistanceTravelled = 0

let sourceLon,
  sourceLat,
  destinationLon,
  destinationLat

var line
var legDistance = 0
var options = { units: 'miles' }
var totalLegDistance = 0
var totalDistance = 0
var currentLegDistance = 0
var distanceDifference = 0

var framesPerSecond = 20;
var initialOpacity = 1
var opacity = initialOpacity;
var initialRadius = 8;
var radius = initialRadius;
var maxRadius = 18;

var baseURL = "https://api.mapbox.com/directions/v5/mapbox/walking/"
var coordinateString = `${sourceLon}%2C${sourceLat}%3B${destinationLon}%2C${destinationLat}`
var finalURL = `${baseURL}${coordinateString}?alternatives=false&geometries=geojson&steps=false&access_token=${token}`
var placeURL = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
var point

const updateData = (collection, document, id, data) => {
  db.collection(collection).doc(document).update({
    [`${id}`]: data
  }).then(() => {
    console.log("document updated successfully!")
  }).catch((error) => {
    console.log(error)
  })
}

const createNewDataset = (collection) => {
  var progressData = {
    activeRoute: "",
    currentLocation: new firebase.firestore.GeoPoint(1, 1),
    distanceTravelled: 0,
    lastDestination: "",
    leg: 0,
    totalDistance: 0,
    newLeg: false
  }

  db.collection(collection).doc("routes").set({})
  db.collection(collection).doc("progress").set(progressData)


}

const encodeData = (data) => {
  var path = ""
  var i = 0
  do {
    path += data[i] + ";"
    i++
  } while (i < data.length)
  return path
}

const decodeData = (data) => {
  if (data != null) {
    var firstArray = data.split(";")
    var secondArray = []
    for (var i = 0; i < firstArray.length - 1; i++) {
      var tempArray = firstArray[i].split(",")
      var tempArray2 = []
      tempArray2.push(parseFloat(tempArray[0]))
      tempArray2.push(parseFloat(tempArray[1]))
      secondArray.push(tempArray2)
    }
    return secondArray
  }

}

function App() {
  const [distance, setDistance] = useState(0)
  const [theMap, setMap] = useState(null)
  const [source, setSource] = useState("Brighton")
  const [destination, setDestination] = useState("")
  const [newLeg, setNewLeg] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const mapContainer = useRef(null)

  const initialize = (collection) => {
    db.collection(collection).get()
      .then((snapshot) => {
        snapshot.docs.map(doc => {
          // set master data
          masterData[doc.id] = [doc.data()]
        })
      }).then(() => {
        var keys = Object.keys(masterData["routes"][0])
        for (var key of keys) {
          routeData[key] = decodeData(masterData["routes"][0][key])
        }
        leg = masterData["progress"][0]["leg"]
        activeRoute = masterData["progress"][0]["activeRoute"]
        lastDestination = masterData["progress"][0]["lastDestination"]
        currentLocation.push(masterData["progress"][0]["currentLocation"]["_long"])
        currentLocation.push(masterData["progress"][0]["currentLocation"]["_lat"])
        currentDistanceTravelled = masterData["progress"][0]["distanceTravelled"]
        totalDistance = masterData["progress"][0]["totalDistance"]
        setNewLeg(masterData["progress"][0]["newLeg"])
      }).then(() => {
        buildMap(theMap)
      })
  }

  async function login() {
    firebase.auth()
      .signInWithPopup(provider)
      .then((result) => {
        console.log(result)
        userId = result.user.uid
        console.log(userId)
        userName = result.user.displayName
        if(result.additionalUserInfo.isNewUser) {
          setNewLeg(true)
          createNewDataset(userId)
        } else {
          initialize(userId)
          
        }
      })
      .then(() => {
        setLoggedIn(true)
      })
      .catch((error) => {
        console.log(error)
      })
  }

  const updateMap = (s, d) => {
    //set unique source id by incrementing leg by 1
    leg++
    currentRouteId = routePrefix + String(leg)
    //TODO: Logic to check that both values have been completed
    let searchURLSource = `${placeURL}${s}.json?access_token=${accessToken}`
    let searchURLDestination = `${placeURL}${d}.json?access_token=${accessToken}`

    axios.get(searchURLSource)
      .then((response) => {
        sourceLon = response.data.features[0].geometry.coordinates[0]
        sourceLat = response.data.features[0].geometry.coordinates[1]
      })
      .then(() => {
        axios.get(searchURLDestination)
          .then((response) => {
            destinationLon = response.data.features[0].geometry.coordinates[0]
            destinationLat = response.data.features[0].geometry.coordinates[1]
          })
          .then(() => {
            //add to routes object
            coordinateString = `${sourceLon}%2C${sourceLat}%3B${destinationLon}%2C${destinationLat}`
            finalURL = `${baseURL}${coordinateString}?alternatives=false&geometries=geojson&steps=false&access_token=${token}`

            axios.get(finalURL)
              .then((response) => {
                // update db data
                routeData[currentRouteId] = response.data.routes[0].geometry.coordinates
                updateData(userId, 'routes', currentRouteId, encodeData(response.data.routes[0].geometry.coordinates))
                updateData(userId, 'progress', 'leg', leg)
                updateData(userId, 'progress', 'activeRoute', currentRouteId)
                updateData(userId, "progress", "lastDestination", d)
              }).then(() => {
                setNewLeg(false)
                updateData(userId, "progress", "newLeg", false)
                var route = {
                  'type': 'FeatureCollection',
                  'features': [
                    {
                      'type': 'Feature',
                      'properties': {},
                      'geometry': {
                        'type': 'LineString',
                        'coordinates': routeData[currentRouteId]
                      }
                    }
                  ]
                }
                theMap.addSource(currentRouteId, {
                  'type': 'geojson',
                  'data': route
                })
                theMap.addLayer({
                  'id': currentRouteId,
                  'type': 'line',
                  'source': currentRouteId,
                  'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                  },
                  'paint': {
                    'line-color': routeColor,
                    'line-width': routeLineWidth
                  }
                })
              })
              .then(() => {
                setProgress(distanceDifference)
              })
          })
      })

  }

  const buildMap = (currentMap) => {
    if (currentMap != null) {
      //1. define routes object and loop through
      var point = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'properties': {},
            'geometry': {
              'type': 'Point',
              'coordinates': currentLocation
            }
          }
        ]
      }
      currentMap.addSource('point', {
        'type': 'geojson',
        'data': point
      })
      var routeKeys = Object.keys(routeData)
      for (const key of routeKeys) {
        var route = {
          'type': 'FeatureCollection',
          'features': [
            {
              'type': 'Feature',
              'properties': {},
              'geometry': {
                'type': 'LineString',
                'coordinates': routeData[key]
              }
            }
          ]
        }
        currentMap.addSource(key, {
          'type': 'geojson',
          'data': route
        })
        currentMap.addLayer({
          'id': key,
          'type': 'line',
          'source': key,
          'layout': {
            'line-join': 'round',
            'line-cap': 'round'
          },
          'paint': {
            'line-color': routeColor,
            'line-width': routeLineWidth
          }
        })
      }
      currentMap.addLayer({
        'id': 'point',
        'source': 'point',
        'type': 'circle',
        'paint': {
          'circle-radius': initialRadius,
          'circle-radius-transition': { duration: 0 },
          'circle-opacity-transition': { duration: 0 },
          'circle-color': markerColor
        }
      })
    }

  }

  const animateMarker = (timestamp, currentMap) => {
    setTimeout(function () {
      requestAnimationFrame(animateMarker);

      radius += (maxRadius - radius) / framesPerSecond;
      opacity -= (.9 / framesPerSecond);
      if (opacity <= 0) {
        radius = initialRadius;
        opacity = initialOpacity;
      }

      if (currentMap != null) {
        currentMap.setPaintProperty('point', 'circle-radius', radius);
        currentMap.setPaintProperty('point', 'circle-opacity', opacity);
      }



    }, 1000 / framesPerSecond);

  }
  
  const setProgress = (d) => {
    totalDistance += parseFloat(d)
    currentDistanceTravelled += parseFloat(d)
    updateData(userId, "progress", "distanceTravelled", currentDistanceTravelled)
    updateData(userId, "progress", "totalDistance", totalDistance)
    currentRouteId = routePrefix + String(leg)

    line = turf.lineString(routeData[currentRouteId])
    point = turf.along(line, currentDistanceTravelled, options)
    currentLegDistance = turf.length(line, options)
    console.log(totalLegDistance, legDistance)
    // check if user has reached their destination...
    if (currentDistanceTravelled >= currentLegDistance) {
      //if they have show place text input field
      setNewLeg(true)
      updateData(userId, "progress", "newLeg", true)
      setSource(lastDestination)
      distanceDifference = currentDistanceTravelled - currentLegDistance
      currentDistanceTravelled = 0
      updateData(userId, "progress", "distanceTravelled", 0)
      console.log(currentDistanceTravelled, currentLegDistance, distanceDifference)

    }

    var icon = {
      'type': 'FeatureCollection',
      'features': [
        {
          'type': 'Feature',
          'properties': {},
          'geometry': {
            'type': 'Point',
            'coordinates': point.geometry.coordinates
          }
        }
      ]
    }

    let pointSource = theMap.getSource('point')

    if (pointSource === undefined) {
      //set a new source
      console.log('new source')
      theMap.addSource('point', {
        'type': 'geojson',
        'data': icon
      })
      theMap.addLayer({
        'id': 'point',
        'source': 'point',
        'type': 'circle',
        'paint': {
          'circle-radius': initialRadius,
          'circle-radius-transition': { duration: 0 },
          'circle-opacity-transition': { duration: 0 },
          'circle-color': markerColor
        }
      }, activeRoute)
    } else {
      //update current source
      theMap.getSource('point').setData(icon)
    }

    let currentLocation = new firebase.firestore.GeoPoint(point.geometry.coordinates[1], point.geometry.coordinates[0])

    updateData(userId, "progress", "currentLocation", currentLocation)

  }

  useEffect(() => {
    mapboxgl.accessToken = token
    var map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [0.10089, 50.773585],
      zoom: zoomLevel
    });

    //entry poiint
    map.on('load', () => {
      setMap(map)
      let routeIsEmpty = Object.keys(routeData).length === 0
      console.log(routeIsEmpty)
      //on first load, check if there are any routes.  If not, ask user to input first source.  If so build map sources and layers
      if (routeIsEmpty) {
        setNewLeg(true)
      } else {
        setNewLeg(false)
        //buildMap(map)
      }
    })
    //animateMarker(0)

  }, [])

  return (
    <>
    
      <div className="map-container" ref={mapContainer} />
      <div className="login-container">
        <p>Please <span hidden={loggedIn} onClick={() => login()}>Login</span></p>
      </div>
      <div className="user-input-container" hidden={!loggedIn}>
        <input className="user-input-textfield" disabled={newLeg} onChange={event => setDistance(event.target.value)} />
        <button className="user-input-button" onClick={() => setProgress(distance)}>Walk</button>
        <p>{totalDistance}</p>
        <input className="user-input-textfield" id="source-input" disabled={!newLeg} onChange={event => setSource(event.target.value)} defaultValue={lastDestination} />
        <input className="user-input-textfield" id="destination-input" disabled={!newLeg} onChange={event => setDestination(event.target.value)} />
        <button className="user-input-button" disabled={!newLeg} onClick={() => updateMap(source, destination)}>Set</button>
      </div>
    </>
  );
}

export default App;
