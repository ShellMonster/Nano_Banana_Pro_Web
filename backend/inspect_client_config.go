//go:build tools
// +build tools

package main

import (
	"fmt"
	"reflect"
	"google.golang.org/genai"
)

func main() {
	t := reflect.TypeOf(genai.ClientConfig{})
	for i := 0; i < t.NumField(); i++ {
		fmt.Println(t.Field(i).Name)
	}
}
