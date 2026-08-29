package utilds

import (
	"testing"
	"time"
)

func TestWorkQueueRejectsItemsAtCapacity(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	wq := NewWorkQueueWithLimit(func(item int) {
		if item == 1 {
			close(started)
			<-release
		}
	}, 2)

	if !wq.Enqueue(1) {
		t.Fatal("first item should be accepted")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}
	if !wq.Enqueue(2) || !wq.Enqueue(3) {
		t.Fatal("items within queue capacity should be accepted")
	}
	if wq.Enqueue(4) {
		t.Fatal("item above queue capacity should be rejected")
	}

	close(release)
	wq.Close(false)
	wq.Wait()
}
