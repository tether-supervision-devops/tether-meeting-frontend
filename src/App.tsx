import "./App.css";
import { ZoomMtg } from "@zoom/meetingsdk";
import { useEffect, useRef, useState } from "react";

// Preload Zoom SDK
ZoomMtg.preLoadWasm();
ZoomMtg.prepareWebSDK();

function App() {
  // Get query parameters from URL
  const urlParams = new URLSearchParams(window.location.search);
  const meetingNumber = urlParams.get("meetingNumber") ?? "";
  const passWord = urlParams.get("passWord") ?? "";
  const userName = urlParams.get("userName") ?? "";
  const leaveUrl = urlParams.get("leaveUrl") ?? "https://app.tethersupervision.com";
  const uuid = urlParams.get("uuid") ?? "";

  const authEndpoint =
    "https://tether-meetingsdk-auth-endpoint-production.up.railway.app/sign";

  // Prevent double init/join (React 18 StrictMode + re-click)
  const startedRef = useRef(false);
  const signatureExpRef = useRef<number | null>(null);
  const [joining, setJoining] = useState(false);

  async function fetchSignature(): Promise<{ signature: string; zak?: string; exp?: number; zoomEmail?: string }> {
    const req = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingNumber, uuid, videoWebRtcMode: 1 }),
    });
    const res = await req.json();
    if (!res.signature) throw new Error("No signature returned from server");
    if (res.exp) signatureExpRef.current = res.exp * 1000;
    console.log("Fetched payload from /sign:", res);
    return res;
  }

  const getSignature = async () => {
    if (startedRef.current || joining) return;
    startedRef.current = true;
    setJoining(true);
    try {
      console.log("URL Params:", { meetingNumber, passWord, userName, uuid, leaveUrl });
      const res = await fetchSignature();
      const zak = (typeof res.zak === "string" && res.zak.trim() !== "") ? res.zak : undefined;
      const emailToUse = (res.zoomEmail && typeof res.zoomEmail === "string" && res.zoomEmail.trim() !== "") ? res.zoomEmail : `${uuid}@tether.local`;
      console.log("Using userEmail for startMeeting:", emailToUse);
      startMeeting(res.signature, zak, emailToUse);
    } catch (e) {
      console.error("Signature fetch error:", e);
      alert("Failed to get signature");
      startedRef.current = false;
    } finally {
      setJoining(false);
    }
  };

  const startMeeting = (signature: string, zak?: string, email?: string) => {
    const rootElement = document.getElementById("zmmtg-root");
    if (rootElement) rootElement.style.display = "block";

    ZoomMtg.init({
      leaveUrl,
      patchJsMedia: true,
      leaveOnPageUnload: true,
      success: () => {
        console.log("Init success");

        // @ts-expect-error: "disconnect" is not in types but works at runtime
        ZoomMtg.inMeetingServiceListener("disconnect", async () => {
          console.warn("Zoom disconnected; attempting to rejoin…");
          try {
            const msLeft = (signatureExpRef.current ?? 0) - Date.now();
            const needNewSig = msLeft < 60_000;
            let signatureToUse = "";
            let zakToUse: string | undefined = undefined;
            let emailToUse = email;
            if (needNewSig) {
              const fresh = await fetchSignature();
              signatureToUse = fresh.signature;
              zakToUse = (typeof fresh.zak === "string" && fresh.zak.trim() !== "") ? fresh.zak : undefined;
              emailToUse = (fresh.zoomEmail && typeof fresh.zoomEmail === "string" && fresh.zoomEmail.trim() !== "") ? fresh.zoomEmail : `${uuid}@tether.local`;
            } else {
              const current = await fetchSignature();
              signatureToUse = current.signature;
              zakToUse = (typeof current.zak === "string" && current.zak.trim() !== "") ? current.zak : undefined;
              emailToUse = (current.zoomEmail && typeof current.zoomEmail === "string" && current.zoomEmail.trim() !== "") ? current.zoomEmail : `${uuid}@tether.local`;
            }
            console.log("Using userEmail for rejoin:", emailToUse);
            ZoomMtg.join({
              signature: signatureToUse,
              meetingNumber,
              passWord,
              userName,
              userEmail: emailToUse, // always include
              ...(zakToUse ? { zak: zakToUse } : {}),
              success: () => console.log("Rejoin success"),
              error: (err: unknown) => {
                console.error("Rejoin failed", err);
                try { ZoomMtg.leaveMeeting({}); } catch { }
                fetchSignature()
                  .then(f => {
                    const validZak = (typeof f.zak === "string" && f.zak.trim() !== "") ? f.zak : undefined;
                    const emailToPass = (f.zoomEmail && typeof f.zoomEmail === "string" && f.zoomEmail.trim() !== "") ? f.zoomEmail : `${uuid}@tether.local`;
                    startMeeting(f.signature, validZak, emailToPass);
                  })
                  .catch(e => console.error("Full restart failed", e));
              },
            } as any);
          } catch (err) {
            console.error("Rejoin flow error", err);
          }
        });

        const joinParams: any = {
          signature,
          meetingNumber,
          passWord,
          userName,
          userEmail: email, // always include for attendees
          // sdkKey: not needed on v4+ (removing to avoid warning)
          ...(typeof zak === "string" && zak.trim() !== "" ? { zak } : {}),
          success: (success: unknown) => {
            console.log("Join success:", success);
          },
          error: (error: unknown) => {
            console.error("Join error:", error);
          },
        } as any;

        console.log("Joining Zoom with:", { meetingNumber, passWord, userName, signature, zak, userEmail: email });
        ZoomMtg.join(joinParams);
      },
      error: (error: unknown) => {
        console.error("Init error:", error);
        // let user retry if init fails
        startedRef.current = false;
      },
    });
  };

  // Auto-join once on first mount if credentials provided
  useEffect(() => {
    if (meetingNumber && userName) {
      getSignature();
    }
    // IMPORTANT: empty deps so StrictMode’s double-call won’t re-run this due to dep changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const goOffline = () => console.warn("You’re offline — Zoom will try to reconnect.");
    const goOnline = () => console.warn("Back online — reconnecting if needed…");
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return (
  <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-100 via-blue-200 to-blue-300 text-center px-8 font-sans">
    <main className="max-w-xl bg-white rounded-3xl shadow-2xl p-16 transition-all duration-500 hover:shadow-3xl ring-1 ring-blue-50">
      {/* Logo */}
      <img
        src="https://cdn.prod.website-files.com/67452425f61385512d1640b8/68661d220ff8dfd62198a6f7_Tether%20Logo%20(2)-p-500.png"
        alt="Tether Supervision Logo"
        className="mx-auto h-24 mb-10 transition-transform duration-500 hover:scale-110"
      />
  
      <h1 className="text-5xl font-extrabold text-blue-950 mb-6 tracking-tight animate-fade-in">Tether Supervision</h1>
  
      {!meetingNumber || !userName ? (
        <>
          <h2 className="text-3xl font-semibold text-gray-900 mb-5 animate-fade-in">Thank You</h2>
          <p className="text-gray-700 leading-relaxed text-lg animate-fade-in">
            We appreciate your use of Tether Supervision.  
            Please refresh the supervision screen to start a new session.
          </p>
        </>
      ) : (
        <>
          <p className="text-gray-700 mb-10 leading-relaxed text-xl animate-fade-in">
            You are about to join a secure Tether Supervision session.
          </p>
          <button
            disabled={joining}
            onClick={getSignature}
            className={`w-full py-4 px-8 rounded-xl font-semibold transition-all duration-300 shadow-lg 
              ${joining ? "bg-gray-400 cursor-not-allowed opacity-70" : "bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-400 focus:ring-opacity-50"} animate-fade-in`}
          >
            {joining ? "Joining…" : "Join Meeting"}
          </button>
        </>
      )}
    </main>
  
    <div id="zmmtg-root" style={{ display: "none" }}></div>
  </div>
  );
}

export default App;
