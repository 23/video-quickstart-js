const GO_BUTTON_START = "Publish";
const GO_BUTTON_STOP = "Stop";

var localVideo = null;
var remoteVideo = null;
var peerConnection = null;
var peerConnectionConfig = { iceServers: [] };
var localStream = null;
var wsURL = "wss://localhost.streamlock.net/webrtc-session.json";
var wsConnection = null;
var streamInfo = {
  applicationName: "webrtc",
  streamName: "myStream",
  sessionId: "[empty]"
};
var userData = { param1: "value1" };
var videoBitrate = 360;
var audioBitrate = 64;
var videoFrameRate = "29.97";
var userAgent = null;
var newAPI = true;

function pageReady() {
  userAgent = $("#userAgent")
    .val()
    .toLowerCase();

  if (userAgent == null) {
    userAgent = "unknown";
  }

  $("#buttonGo").attr("value", GO_BUTTON_START);

  console.log("newAPI: " + newAPI);
}

function setStream(stream) {
  localStream = stream;
  const localVideo = document.getElementById("wowzaVideo");
  localVideo.src = window.URL.createObjectURL(stream);
}

function wsConnect(url) {
  wsConnection = new WebSocket(url);
  wsConnection.binaryType = "arraybuffer";

  wsConnection.onopen = function() {
    console.log("wsConnection.onopen");

    peerConnection = new RTCPeerConnection(peerConnectionConfig);
    peerConnection.onicecandidate = gotIceCandidate;

    if (newAPI) {
      var localTracks = localStream.getTracks();
      for (localTrack in localTracks) {
        peerConnection.addTrack(localTracks[localTrack], localStream);
      }
    } else {
      peerConnection.addStream(localStream);
    }

    peerConnection.createOffer(gotDescription, errorHandler);
  };

  wsConnection.onmessage = function(evt) {
    console.log("wsConnection.onmessage: " + evt.data);

    var msgJSON = JSON.parse(evt.data);

    var msgStatus = Number(msgJSON["status"]);
    var msgCommand = msgJSON["command"];

    if (msgStatus != 200) {
      $("#sdpDataTag").html(msgJSON["statusDescription"]);
      stopPublisher();
    } else {
      $("#sdpDataTag").html("");

      var sdpData = msgJSON["sdp"];
      if (sdpData !== undefined) {
        console.log("sdp: " + msgJSON["sdp"]);

        peerConnection.setRemoteDescription(
          new RTCSessionDescription(sdpData),
          function() {
            //peerConnection.createAnswer(gotDescription, errorHandler);
          },
          errorHandler
        );
      }

      var iceCandidates = msgJSON["iceCandidates"];
      if (iceCandidates !== undefined) {
        for (var index in iceCandidates) {
          console.log("iceCandidates: " + iceCandidates[index]);

          peerConnection.addIceCandidate(
            new RTCIceCandidate(iceCandidates[index])
          );
        }
      }
    }

    if (wsConnection != null) wsConnection.close();
    wsConnection = null;
  };

  wsConnection.onclose = function() {
    console.log("wsConnection.onclose");
  };

  wsConnection.onerror = function(evt) {
    console.log("wsConnection.onerror: " + JSON.stringify(evt));

    $("#sdpDataTag").html("WebSocket connection failed: " + wsURL);
    stopPublisher();
  };
}

class StreamMixerService {
  constructor() {
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;

    this.audioContext = new AudioContextConstructor();
    this.audioSources = new Map();
    this.audioDestination = this.audioContext.createMediaStreamDestination();
  }

  addAudioTrack(track) {
    const stream = new MediaStream([track]);
    const audioSource = this.audioContext.createMediaStreamSource(stream);

    this.audioSources.set(track.id, audioSource);

    if (this.destinationStream) {
      audioSource.connect(this.audioDestination);
    }
  }

  removeAudioTrack(track) {
    this.removeAudioTrackById(track.id);
  }

  removeAudioTrackById(trackId) {
    const audioSource = this.audioSources.get(trackId);

    if (audioSource) {
      audioSource.disconnect(this.audioDestination);

      this.audioSources.delete(trackId);
    }
  }

  getMixedStream() {
    if (this.destinationStream) {
      return this.destinationStream;
    }

    this.audioSources.forEach(audioSource =>
      audioSource.connect(this.audioDestination)
    );

    const destinationStream = this.audioDestination.stream;

    this.destinationStream = destinationStream;

    return destinationStream;
  }
}

function startPublisher() {
  wsURL = $("#sdpURL").val();
  streamInfo.applicationName = $("#applicationName").val();
  streamInfo.streamName = $("#streamName").val();
  videoBitrate = $("#videoBitrate").val();
  audioBitrate = $("#audioBitrate").val();
  videoFrameRate = $("#videoFrameRate").val();
  userAgent = $("#userAgent")
    .val()
    .toLowerCase();

  console.log(
    "startPublisher: wsURL:" +
      wsURL +
      " streamInfo:" +
      JSON.stringify(streamInfo)
  );

  wsConnect(wsURL);

  $("#buttonGo").attr("value", GO_BUTTON_STOP);
}

function stopPublisher() {
  if (peerConnection != null) peerConnection.close();
  peerConnection = null;

  if (wsConnection != null) wsConnection.close();
  wsConnection = null;

  $("#buttonGo").attr("value", GO_BUTTON_START);

  console.log("stopPublisher");
}

function start() {
  if (peerConnection == null) startPublisher();
  else stopPublisher();
}

function gotIceCandidate(event) {
  if (event.candidate != null) {
    console.log("gotIceCandidate: " + JSON.stringify({ ice: event.candidate }));
  }
}

function gotDescription(description) {
  var enhanceData = new Object();

  if (audioBitrate !== undefined)
    enhanceData.audioBitrate = Number(audioBitrate);
  if (videoBitrate !== undefined)
    enhanceData.videoBitrate = Number(videoBitrate);
  if (videoFrameRate !== undefined)
    enhanceData.videoFrameRate = Number(videoFrameRate);

  description.sdp = enhanceSDP(description.sdp, enhanceData);

  console.log("gotDescription: " + JSON.stringify({ sdp: description }));

  peerConnection.setLocalDescription(
    description,
    function() {
      wsConnection.send(
        '{"direction":"publish", "command":"sendOffer", "streamInfo":' +
          JSON.stringify(streamInfo) +
          ', "sdp":' +
          JSON.stringify(description) +
          ', "userData":' +
          JSON.stringify(userData) +
          "}"
      );
    },
    function() {
      console.log("set description error");
    }
  );
}

function enhanceSDP(sdpStr, enhanceData) {
  var sdpLines = sdpStr.split(/\r\n/);
  var sdpSection = "header";
  var hitMID = false;
  var sdpStrRet = "";

  for (var sdpIndex in sdpLines) {
    var sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length <= 0) continue;

    sdpStrRet += sdpLine;

    if (sdpLine.indexOf("m=audio") === 0) {
      sdpSection = "audio";
      hitMID = false;
    } else if (sdpLine.indexOf("m=video") === 0) {
      sdpSection = "video";
      hitMID = false;
    } else if (sdpLine.indexOf("a=rtpmap") == 0) {
      sdpSection = "bandwidth";
      hitMID = false;
    }

    if (sdpLine.indexOf("a=mid:") === 0 || sdpLine.indexOf("a=rtpmap") == 0) {
      if (!hitMID) {
        if ("audio".localeCompare(sdpSection) == 0) {
          if (enhanceData.audioBitrate !== undefined) {
            sdpStrRet += "\r\nb=CT:" + enhanceData.audioBitrate;
            sdpStrRet += "\r\nb=AS:" + enhanceData.audioBitrate;
          }
          hitMID = true;
        } else if ("video".localeCompare(sdpSection) == 0) {
          if (enhanceData.videoBitrate !== undefined) {
            sdpStrRet += "\r\nb=CT:" + enhanceData.videoBitrate;
            sdpStrRet += "\r\nb=AS:" + enhanceData.videoBitrate;
            if (enhanceData.videoFrameRate !== undefined) {
              sdpStrRet += "\r\na=framerate:" + enhanceData.videoFrameRate;
            }
          }
          hitMID = true;
        } else if ("bandwidth".localeCompare(sdpSection) == 0) {
          var rtpmapID;
          rtpmapID = getrtpMapID(sdpLine);
          if (rtpmapID !== null) {
            var match = rtpmapID[2].toLowerCase();
            if (
              "vp9".localeCompare(match) == 0 ||
              "vp8".localeCompare(match) == 0 ||
              "h264".localeCompare(match) == 0 ||
              "red".localeCompare(match) == 0 ||
              "ulpfec".localeCompare(match) == 0 ||
              "rtx".localeCompare(match) == 0
            ) {
              if (enhanceData.videoBitrate !== undefined) {
                sdpStrRet +=
                  "\r\na=fmtp:" +
                  rtpmapID[1] +
                  " x-google-min-bitrate=" +
                  enhanceData.videoBitrate +
                  ";x-google-max-bitrate=" +
                  enhanceData.videoBitrate;
              }
            }

            if (
              "opus".localeCompare(match) == 0 ||
              "isac".localeCompare(match) == 0 ||
              "g722".localeCompare(match) == 0 ||
              "pcmu".localeCompare(match) == 0 ||
              "pcma".localeCompare(match) == 0 ||
              "cn".localeCompare(match) == 0
            ) {
              if (enhanceData.audioBitrate !== undefined) {
                sdpStrRet +=
                  "\r\na=fmtp:" +
                  rtpmapID[1] +
                  " x-google-min-bitrate=" +
                  enhanceData.audioBitrate +
                  ";x-google-max-bitrate=" +
                  enhanceData.audioBitrate;
              }
            }
          }
        }
      }
    }
    sdpStrRet += "\r\n";
  }
  return sdpStrRet;
}

function getrtpMapID(line) {
  var findid = new RegExp("a=rtpmap:(\\d+) (\\w+)/(\\d+)");
  var found = line.match(findid);
  return found && found.length >= 3 ? found : null;
}

function errorHandler(error) {
  console.log(error);
}

window.wowza = {
  setStream
};
