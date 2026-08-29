package wshutil

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func capabilityTestContext(source string, rpcCtx wshrpc.RpcContext) context.Context {
	handler := &RpcResponseHandler{
		source: source,
		rpcCtx: rpcCtx,
	}
	return withRespHandler(context.Background(), handler)
}

func TestHasRpcCapabilityDeniesShellProcessByDefault(t *testing.T) {
	ctx := capabilityTestContext("proc:untrusted-shell", wshrpc.RpcContext{ProcRoute: true})
	if HasRpcCapability(ctx, wshrpc.RpcCapabilitySecretRead) {
		t.Fatal("shell process unexpectedly received secret read capability")
	}
	if HasRpcCapability(ctx, wshrpc.RpcCapabilitySecretWrite) {
		t.Fatal("shell process unexpectedly received secret write capability")
	}
}

func TestHasRpcCapabilityAllowsTrustedUIRoutes(t *testing.T) {
	for _, source := range []string{"tab:test-tab", "builder:test-builder"} {
		t.Run(source, func(t *testing.T) {
			ctx := capabilityTestContext(source, wshrpc.RpcContext{})
			if !HasRpcCapability(ctx, wshrpc.RpcCapabilitySecretRead) {
				t.Fatal("trusted UI route should retain secret read capability")
			}
			if !HasRpcCapability(ctx, wshrpc.RpcCapabilitySecretWrite) {
				t.Fatal("trusted UI route should retain secret write capability")
			}
		})
	}
}
