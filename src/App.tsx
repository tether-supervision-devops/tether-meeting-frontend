import "./App.css";
import { ZoomMtg } from "@zoom/meetingsdk";
import { useEffect } from "react";

// Preload Zoom SDK
ZoomMtg.preLoadWasm();
ZoomMtg.prepareWebSDK();

function App() {
  // Get query parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  const meetingNumber = urlParams.get("meetingNumber") || "0";
  const passWord = urlParams.get("passWord") || "";
  const role = parseInt(urlParams.get("role") || "0", 10);
  const userName = urlParams.get("userName") || "React";
  const userEmail = urlParams.get("userEmail") || "react@zoom.us";
  const registrantToken = urlParams.get("registrantToken") || "";
  const leaveUrl = urlParams.get("leaveUrl") || "app.tethersupervision.com";

  const authEndpoint = "https://meetingsdk-auth-endpoint-sample-production-c11f.up.railway.app";

  const getSignature = async () => {
    try {
      const req = await fetch(authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingNumber,
          role,
          userEmail,
          videoWebRtcMode: 1,
        }),
      });
      const res = await req.json();

      if (!res.signature) {
        throw new Error("No signature returned from server");
      }

      // ✅ Grab signature AND zak from backend
      startMeeting(res.signature, res.zak || "");
    } catch (e) {
      console.error("Signature fetch error:", e);
      alert("Failed to get signature");
    }
  };

  const startMeeting = (signature: string, zak: string) => {
    const rootElement = document.getElementById("zmmtg-root");
    if (rootElement) {
      rootElement.style.display = "block";
    }

    ZoomMtg.init({
      leaveUrl,
      patchJsMedia: true,
      leaveOnPageUnload: true,
      success: () => {
        console.log("Init success");
        ZoomMtg.join({
          signature,
          meetingNumber,
          passWord,
          userName,
          userEmail,
          tk: registrantToken,
          zak, // ✅ dynamically passed in
          success: (success: unknown) => {
            console.log("Join success:", success);
          },
          error: (error: unknown) => {
            console.error("Join error:", error);
          },
        });
      },
      error: (error: unknown) => {
        console.error("Init error:", error);
      },
    });
  };

  // Optionally, trigger getSignature automatically if all required parameters are present
  useEffect(() => {
    if (meetingNumber && userName) {
      getSignature();
    }
  }, [meetingNumber, userName]);

  return (
    <div className="App">
      <main>
        <h1>Zoom Meeting SDK Sample React</h1>
        {!meetingNumber || !userName ? (
          <p>Please provide meetingNumber and userName in the URL</p>
        ) : (
          <button onClick={getSignature}>Join Meeting</button>
        )}
      </main>
    </div>
  );
}

export default App;