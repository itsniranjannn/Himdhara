import { useEffect, useRef, useState } from "react";

export function useWebSocket(url, onMessage) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let unmounted = false;

    let retryDelay = 1000;

    function scheduleReconnect() {
      if (!unmounted && !reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    }

    function connect() {
      if (unmounted) return;
      
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!unmounted) {
            setIsConnected(true);
            retryDelay = 1000;
            // Ping heartbeat every 15s
            pingIntervalRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send("ping");
              }
            }, 15000);
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type !== "pong" && onMessageRef.current) {
              onMessageRef.current(data);
            }
          } catch (e) {
            console.error("WS Parse Error:", e);
          }
        };

        ws.onclose = () => {
          if (!unmounted) {
            setIsConnected(false);
            clearInterval(pingIntervalRef.current);
            scheduleReconnect();
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        console.error("WebSocket connection failure:", err);
        scheduleReconnect();
      }
    }

    connect();

    return () => {
      unmounted = true;
      clearInterval(pingIntervalRef.current);
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url]);

  return { isConnected };
}
