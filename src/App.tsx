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

  // Listen for postMessage from parent for "ASK_FOR_HELP"
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      console.log("Iframe got message:", event.data, "from origin:", event.origin);
      if (event.data?.type === "ASK_FOR_HELP") {
        console.log("Handling ASK_FOR_HELP with getCurrentBreakoutRoom...");
        ZoomMtg.getCurrentBreakoutRoom({
          success: (res: any) => {
            console.log("Current breakout room:", res);
            window.parent.postMessage(
              {
                type: "HELP_REQUEST",
                user: {
                  uuid,
                  userName,
                  meetingNumber,
                  breakoutRoom: {
                    name: res.name,
                    roomId: res.roomId,
                    status: res.attendeeStatus,
                  },
                },
              },
              "*"
            );
          },
          error: (err: any) => {
            console.error("getCurrentBreakoutRoom error:", err);
            window.parent.postMessage(
              { type: "HELP_REQUEST_ERROR", reason: err?.reason || "Unknown error" },
              "*"
            );
          },
        });
      }
    }
  
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div
    style={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      fontFamily: "sans-serif",
      background: "linear-gradient(to bottom right, #ebf8ff, #bfdbfe, #93c5fd)",
    }}
  >
    {/* Main content centered with padding */}
    <main
      style={{
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
      }}
    >
      <div
        style={{
          maxWidth: "40rem",
          background: "white",
          borderRadius: "1.5rem",
          boxShadow: "0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)",
          padding: "64px 48px",
          marginTop: "2.5rem",
          marginBottom: "3rem",
          textAlign: "center",
          border: "1px solid #dbeafe",
          transition: "all 0.5s ease",
        }}
      >
        {/* Logo */}
        <img
          src="https://cdn.prod.website-files.com/67452425f61385512d1640b8/68661d220ff8dfd62198a6f7_Tether%20Logo%20(2)-p-500.png"
          alt="Tether Supervision Logo"
          style={{
            display: "block",
            margin: "0 auto 2.5rem auto",
            height: "96px",
            transition: "transform 0.5s ease",
          }}
          onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
          onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
        />
  
        {!meetingNumber || !userName ? (
          <>
            <h2
              style={{
                fontSize: "1.875rem",
                fontWeight: 600,
                color: "#111827",
                marginBottom: "1.5rem",
              }}
            >
              Thank You
            </h2>
            <p
              style={{
                fontSize: "1.125rem",
                lineHeight: 1.6,
                color: "#374151",
              }}
            >
              We appreciate your use of Tether Supervision. <br />
              Please refresh the supervision screen to start a new session.
            </p>
          </>
        ) : (
          <>
            <p
              style={{
                fontSize: "1.25rem",
                lineHeight: 1.6,
                color: "#374151",
                marginBottom: "2.5rem",
              }}
            >
              You are about to join a secure Tether Supervision session.
            </p>
            <button
              disabled={joining}
              onClick={getSignature}
              style={{
                width: "100%",
                padding: "1rem 2rem",
                borderRadius: "0.75rem",
                fontWeight: 600,
                transition: "all 0.3s ease",
                boxShadow: joining
                  ? "none"
                  : "0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)",
                background: joining
                  ? "#9ca3af"
                  : "linear-gradient(to right, #2563eb, #1d4ed8)",
                color: "white",
                cursor: joining ? "not-allowed" : "pointer",
                opacity: joining ? 0.7 : 1,
              }}
              onMouseOver={(e) => {
                if (!joining)
                  e.currentTarget.style.background =
                    "linear-gradient(to right, #1d4ed8, #1e40af)";
              }}
              onMouseOut={(e) => {
                if (!joining)
                  e.currentTarget.style.background =
                    "linear-gradient(to right, #2563eb, #1d4ed8)";
              }}
            >
              {joining ? "Joining…" : "Join Meeting"}
            </button>
          </>
        )}
      </div>
    </main>
  
    {/* Footer with spacing */}
    <footer
      style={{
        textAlign: "center",
        padding: "1.5rem 0",
        fontSize: "0.875rem",
        color: "#4b5563",
        borderTop: "1px solid #dbeafe",
      }}
    >
      <p style={{ marginBottom: "0.25rem" }}>
        © {new Date().getFullYear()} Tether Supervision
      </p>
      <p style={{ color: "#6b7280" }}>
        HIPAA-compliant supervision platform • All rights reserved
      </p>
    </footer>
  
    <div id="zmmtg-root" style={{ display: "none" }}></div>
  </div>
  );
}

export default App;
