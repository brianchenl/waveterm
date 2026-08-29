// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import "golang.org/x/crypto/ssh/agent"

type IdentityAgentDiagnostics struct {
	Available bool
	KeyCount  int
}

func InspectIdentityAgent(agentPath string) (IdentityAgentDiagnostics, error) {
	conn, err := dialIdentityAgent(agentPath)
	if err != nil {
		return IdentityAgentDiagnostics{}, err
	}
	defer conn.Close()
	keys, err := agent.NewClient(conn).List()
	if err != nil {
		return IdentityAgentDiagnostics{}, err
	}
	return IdentityAgentDiagnostics{Available: true, KeyCount: len(keys)}, nil
}
